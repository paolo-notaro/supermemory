import { describe, expect, it } from "vitest"
import { buildCreateMemoryRequest } from "."

describe("create memory requests", () => {
	it("omits id so the API generates a new document ID", () => {
		expect(buildCreateMemoryRequest("Initial configuration")).toEqual({
			content: "Initial configuration",
			metadata: { sm_source: "supermemory-mcp" },
		})
	})

	it("maps documentId to the API id used for append ingestion", () => {
		expect(
			buildCreateMemoryRequest("Confirmed upgrade: RTX 4070", {
				documentId: "bench-dyn-20261020170455",
			}),
		).toEqual({
			content: "Confirmed upgrade: RTX 4070",
			metadata: { sm_source: "supermemory-mcp" },
			id: "bench-dyn-20261020170455",
		})
	})

	it("combines stable append ingestion with instant extraction", () => {
		expect(
			buildCreateMemoryRequest("Confirmed upgrade: RTX 4070", {
				documentId: "bench-dyn-20261020170455",
				dreaming: "instant",
			}),
		).toEqual({
			content: "Confirmed upgrade: RTX 4070",
			metadata: { sm_source: "supermemory-mcp" },
			id: "bench-dyn-20261020170455",
			dreaming: "instant",
		})
	})
	it("preserves source metadata and SuperRAG controls while keeping the MCP source marker", () => {
		expect(
			buildCreateMemoryRequest("source", {
				taskType: "superrag",
				metadata: { path: "Work.md", sm_source: "spoofed" },
				group: { collection: "vault" },
				date: "2026-11-08T00:00:00Z",
				supportingContext: "Historical source",
			}),
		).toEqual({
			content: "source",
			taskType: "superrag",
			metadata: { path: "Work.md", sm_source: "supermemory-mcp" },
			group: { collection: "vault" },
			date: "2026-11-08T00:00:00Z",
			supportingContext: "Historical source",
		})
	})
})
