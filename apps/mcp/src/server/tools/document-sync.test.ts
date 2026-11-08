import { describe, expect, it, vi } from "vitest"
import type { z } from "zod"
import * as batch from "./batch-add-documents"
import * as update from "./update-document"
import * as remove from "./delete-documents"
import type { ToolDeps } from "./types"
import { errorResult } from "./types"

type Tool = {
	config: {
		inputSchema: z.ZodTypeAny
		outputSchema: z.ZodTypeAny
		annotations: { destructiveHint: boolean }
	}
	cb: (args: Record<string, unknown>) => Promise<{
		structuredContent?: Record<string, unknown>
		isError?: boolean
	}>
}
function setup(permission: "read" | "write" = "write") {
	const tools = new Map<string, Tool>()
	const client = {
		addDocumentsBatch: vi.fn().mockResolvedValue({
			namespace: "secondbrain",
			count: 1,
			failed: 1,
			results: [
				{ id: "a", status: "queued" },
				{ id: "b", status: "error", error: "failed" },
			],
		}),
		updateDocument: vi.fn().mockResolvedValue({
			namespace: "secondbrain",
			id: "a",
			status: "queued",
		}),
		deleteDocuments: vi.fn().mockResolvedValue({
			namespace: "secondbrain",
			count: 1,
			errors: [{ id: "b", error: "not found" }],
		}),
	}
	const deps = {
		server: {
			registerTool: (name: string, config: unknown, cb: unknown) =>
				tools.set(name, { config, cb } as Tool),
		},
		getClient: vi.fn(() => client),
		getSession: vi.fn().mockResolvedValue({
			user: { id: "test-user" },
			accessType: "full",
			scope: { type: "full", permission },
		}),
		resolveNamespace: vi.fn(async (ns?: string) => ns ?? "secondbrain"),
		errorResult,
	} as unknown as ToolDeps
	batch.register(deps)
	update.register(deps)
	remove.register(deps)
	return { tools, client, deps }
}
function registered(tools: Map<string, Tool>, name: string): Tool {
	const tool = tools.get(name)
	if (!tool) throw new Error(`Missing registered tool: ${name}`)
	return tool
}
async function run(tool: Tool, input: unknown) {
	const result = await tool.cb(
		tool.config.inputSchema.parse(input) as Record<string, unknown>,
	)
	return { ...result, structuredContent: result.structuredContent ?? {} }
}

describe("document sync tool contracts", () => {
	it("defaults a batch to SuperRAG, maps stable IDs, and exposes partial failure", async () => {
		const { tools, client, deps } = setup()
		const tool = registered(tools, "batch_add_documents")
		const result = await run(tool, {
			containerTag: "secondbrain",
			documents: [
				{ documentId: "a", content: "source", metadata: { path: "Work.md" } },
				{ documentId: "b", content: "other" },
			],
		})
		expect(deps.resolveNamespace).toHaveBeenCalledWith("secondbrain")
		expect(client.addDocumentsBatch).toHaveBeenCalledWith({
			taskType: "superrag",
			documents: [
				{ id: "a", content: "source", metadata: { path: "Work.md" } },
				{ id: "b", content: "other" },
			],
		})
		expect(result.structuredContent.success).toBe(false)
		expect(result.structuredContent.failed).toBe(1)
		expect(
			tool.config.outputSchema.safeParse(result.structuredContent).success,
		).toBe(true)
	})
	it.each([
		{ documents: [] },
		{
			documents: [
				{ documentId: "a", content: "x" },
				{ documentId: "a", content: "y" },
			],
		},
		{
			documents: Array.from({ length: 601 }, (_, i) => ({
				documentId: String(i),
				content: "x",
			})),
		},
	])("rejects empty, duplicate-ID or over-limit batches", ({ documents }) => {
		expect(
			batch.batchDocumentsInputSchema.safeParse({ documents }).success,
		).toBe(false)
	})
	it("accepts the supported 600-document boundary", () => {
		const documents = Array.from({ length: 600 }, (_, i) => ({
			documentId: String(i),
			content: "x",
		}))
		expect(
			batch.batchDocumentsInputSchema.safeParse({ documents }).success,
		).toBe(true)
	})

	it("bounds payload size before an API call", () => {
		const documents = Array.from({ length: 11 }, (_, i) => ({
			documentId: String(i),
			content: "x".repeat(200000),
		}))
		expect(
			batch.batchDocumentsInputSchema.safeParse({ documents }).success,
		).toBe(false)
	})
	it("accepts both date-only evidence dates and timezone-qualified timestamps", () => {
		for (const date of ["2026-11-08", "2026-11-08T09:00:00+01:00"]) {
			expect(
				batch.batchDocumentsInputSchema.safeParse({
					documents: [{ documentId: "a", content: "x", date }],
				}).success,
			).toBe(true)
		}
		expect(
			batch.batchDocumentsInputSchema.safeParse({
				documents: [{ documentId: "a", content: "x", date: "yesterday" }],
			}).success,
		).toBe(false)
	})

	it("rejects processing-only patches but permits explicitly cleared metadata", () => {
		expect(
			update.updateDocumentInputSchema.safeParse({
				documentId: "a",
				taskType: "superrag",
			}).success,
		).toBe(false)
		expect(
			update.updateDocumentInputSchema.safeParse({
				documentId: "a",
				metadata: {},
			}).success,
		).toBe(true)
	})
	it("replaces only supplied fields and preserves active-space resolution", async () => {
		const { tools, client } = setup()
		const result = await run(registered(tools, "update_document"), {
			documentId: "a",
			content: "replacement",
		})
		expect(client.updateDocument).toHaveBeenCalledWith("a", {
			content: "replacement",
		})
		expect(result.structuredContent.status).toBe("queued")
	})
	it("retains partial deletion errors and destructive annotations", async () => {
		const { tools, client } = setup()
		const tool = registered(tools, "delete_documents")
		const result = await run(tool, { documentIds: ["a", "b"] })
		expect(client.deleteDocuments).toHaveBeenCalledWith(["a", "b"])
		expect(result.structuredContent.success).toBe(false)
		expect(tool.config.annotations.destructiveHint).toBe(true)
		expect(
			tool.config.outputSchema.safeParse(result.structuredContent).success,
		).toBe(true)
	})
	it.each([
		"batch_add_documents",
		"update_document",
		"delete_documents",
	])("rejects a read-only credential before %s reaches the client", async (name) => {
		const { tools, client } = setup("read")
		const input =
			name === "batch_add_documents"
				? { documents: [{ documentId: "a", content: "x" }] }
				: name === "update_document"
					? { documentId: "a", content: "x" }
					: { documentIds: ["a"] }
		expect((await run(registered(tools, name), input)).isError).toBe(true)
		for (const method of Object.values(client))
			expect(method).not.toHaveBeenCalled()
	})
	it("rejects writes outside a restricted member's assigned namespace", async () => {
		const { tools, client, deps } = setup()
		vi.mocked(deps.getSession).mockResolvedValue({
			user: { id: "test-user" },
			accessType: "restricted",
			namespaces: [{ namespace: "other", permission: "write" }],
		})
		expect(
			(
				await run(registered(tools, "delete_documents"), {
					namespace: "secondbrain",
					documentIds: ["a"],
				})
			).isError,
		).toBe(true)
		expect(client.deleteDocuments).not.toHaveBeenCalled()
	})
	it("rejects writes outside a scoped token's namespace", async () => {
		const { tools, client, deps } = setup()
		vi.mocked(deps.getSession).mockResolvedValue({
			user: { id: "test-user" },
			accessType: "full",
			scope: { type: "scoped", permission: "write", tags: ["other"] },
		})
		expect(
			(
				await run(registered(tools, "delete_documents"), {
					namespace: "secondbrain",
					documentIds: ["a"],
				})
			).isError,
		).toBe(true)
		expect(client.deleteDocuments).not.toHaveBeenCalled()
	})
})
