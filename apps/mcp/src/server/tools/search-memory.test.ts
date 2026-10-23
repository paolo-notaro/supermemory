import { describe, expect, it, vi } from "vitest"
import type { z } from "zod"
import * as searchMemory from "./search-memory"
import type { ToolDeps } from "./types"
import { errorResult } from "./types"

function setup() {
	let config:
		| { inputSchema: z.ZodTypeAny; outputSchema: z.ZodTypeAny }
		| undefined
	let callback:
		| ((args: Record<string, unknown>) => Promise<Record<string, unknown>>)
		| undefined
	const client = {
		search: vi.fn().mockResolvedValue({
			results: [
				{
					id: "chunk-1",
					kind: "chunk",
					chunk: "Confirmed upgrade: RTX 4070",
					similarity: 0.89,
					documentId: "doc-1",
					documentTitle: "GPU update",
					documentType: "text",
				},
			],
			total: 1,
			timing: 12,
		}),
	}
	const deps = {
		server: {
			registerTool: (_name: string, toolConfig: unknown, cb: unknown) => {
				config = toolConfig as typeof config
				callback = cb as typeof callback
			},
		},
		getClient: vi.fn(() => client),
		resolveNamespace: vi.fn(async () => "sb-poc"),
		errorResult,
	} as unknown as ToolDeps
	searchMemory.register(deps)
	if (!config || !callback) throw new Error("search_memory not registered")
	return { config, callback, client }
}

describe("search_memory modes", () => {
	it("preserves memory-only behavior when searchMode is omitted", async () => {
		const { config, callback, client } = setup()
		const args = config.inputSchema.parse({ query: "gpu" }) as Record<
			string,
			unknown
		>

		await callback(args)

		expect(client.search).toHaveBeenCalledWith("gpu")
	})

	it("requests hybrid results with source provenance", async () => {
		const { config, callback, client } = setup()
		const args = config.inputSchema.parse({
			query: "gpu",
			searchMode: "hybrid",
		}) as Record<string, unknown>

		const result = await callback(args)

		expect(client.search).toHaveBeenCalledWith("gpu", 10, "hybrid")
		expect(result.structuredContent).toMatchObject({
			results: [
				{
					kind: "chunk",
					documentId: "doc-1",
					documentTitle: "GPU update",
					documentType: "text",
				},
			],
		})
		expect(result.content).toEqual([
			expect.objectContaining({
				text: expect.stringContaining("Matching memories and source passages"),
			}),
		])
		expect(() =>
			config.outputSchema.parse(result.structuredContent),
		).not.toThrow()
	})

	it("rejects unknown search modes", () => {
		const { config } = setup()
		expect(() =>
			config.inputSchema.parse({ query: "gpu", searchMode: "documents" }),
		).toThrow()
	})
})
