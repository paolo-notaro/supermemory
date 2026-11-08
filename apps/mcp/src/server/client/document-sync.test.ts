import { afterEach, describe, expect, it, vi } from "vitest"
import { SupermemoryClient } from "."

function http(response: unknown, status = 200) {
	const fetch = vi.fn().mockResolvedValue(
		new Response(JSON.stringify(response), {
			status,
			headers: { "Content-Type": "application/json" },
		}),
	)
	vi.stubGlobal("fetch", fetch)
	return fetch
}
const client = () =>
	new SupermemoryClient(
		"sm_test_document_sync_key",
		"secondbrain",
		"https://api.example.test",
	)
function sent(fetch: ReturnType<typeof http>) {
	const call = fetch.mock.calls[0]
	if (!call) throw new Error("Expected one API request")
	const [url, init] = call
	return { url: String(url), method: init.method, body: JSON.parse(init.body) }
}
afterEach(() => vi.unstubAllGlobals())

describe("document synchronization API", () => {
	it("uses one batch request and preserves per-document partial failures and provenance", async () => {
		const response = {
			count: 1,
			failed: 1,
			results: [
				{ id: "a", status: "queued" },
				{ id: "b", status: "error", error: "unsupported source" },
			],
		}
		const fetch = http(response)
		expect(
			await client().addDocumentsBatch({
				documents: [
					{
						id: "a",
						content: "source",
						metadata: { path: "Work.md" },
						date: "2026-11-08T00:00:00Z",
					},
					{ id: "b", content: "other" },
				],
				taskType: "superrag",
			}),
		).toEqual({ ...response, namespace: "secondbrain" })
		expect(fetch).toHaveBeenCalledTimes(1)
		expect(sent(fetch)).toEqual({
			url: "https://api.example.test/ns/secondbrain/document/batch",
			method: "POST",
			body: {
				documents: [
					{
						id: "a",
						content: "source",
						metadata: { path: "Work.md", sm_source: "supermemory-mcp" },
						date: "2026-11-08T00:00:00Z",
					},
					{
						id: "b",
						content: "other",
						metadata: { sm_source: "supermemory-mcp" },
					},
				],
				taskType: "superrag",
			},
		})
	})
	it("PATCHes replacement content without changing the source ID or appending", async () => {
		const fetch = http({ id: "a", status: "queued" })
		await client().updateDocument("a", {
			content: "replacement",
			taskType: "superrag",
		})
		expect(sent(fetch)).toEqual({
			url: "https://api.example.test/ns/secondbrain/document/a",
			method: "PATCH",
			body: { content: "replacement", taskType: "superrag" },
		})
	})
	it("does not overwrite omitted metadata on a content-only update", async () => {
		const fetch = http({ id: "a", status: "queued" })
		await client().updateDocument("a", { content: "replacement" })
		expect(sent(fetch).body).not.toHaveProperty("metadata")
	})
	it("deletes exact document IDs and returns partial errors without reporting full success", async () => {
		const response = {
			count: 1,
			errors: [{ id: "missing", error: "not found" }],
		}
		const fetch = http(response)
		expect(await client().deleteDocuments(["a", "missing"])).toEqual({
			...response,
			namespace: "secondbrain",
		})
		expect(sent(fetch)).toEqual({
			url: "https://api.example.test/ns/secondbrain/document",
			method: "DELETE",
			body: { ids: ["a", "missing"] },
		})
	})
	it("never automatically replays an ambiguous batch mutation", async () => {
		const fetch = http({ error: "temporary failure" }, 500)
		await expect(
			client().addDocumentsBatch({
				documents: [{ id: "a", content: "source" }],
			}),
		).rejects.toThrow("Batch document ingestion failed")
		expect(fetch).toHaveBeenCalledTimes(1)
	})
})
