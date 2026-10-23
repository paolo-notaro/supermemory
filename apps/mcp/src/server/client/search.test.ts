import { describe, expect, it } from "vitest"
import type { SearchResponseResultsItem } from "supermemory"
import { mapSearchResults } from "."

describe("search result provenance", () => {
	it("distinguishes memories from source passages and preserves document data", () => {
		const sourceDocument = {
			id: "doc-1",
			title: "GPU update",
			type: "text",
			metadata: {},
			summary: null,
			system: { createdAt: "", updatedAt: "" },
		}
		const response = [
			{
				id: "memory-1",
				memory: "The workstation uses an RTX 4070",
				similarity: 0.91,
				included: { document: sourceDocument },
			},
			{
				id: "chunk-1",
				chunk: "Confirmed upgrade: RTX 4070",
				similarity: 0.89,
				included: { document: sourceDocument },
			},
		] as SearchResponseResultsItem[]

		expect(mapSearchResults(response)).toEqual([
			{
				id: "memory-1",
				kind: "memory",
				memory: "The workstation uses an RTX 4070",
				similarity: 0.91,
				documentId: "doc-1",
				documentTitle: "GPU update",
				documentType: "text",
			},
			{
				id: "chunk-1",
				kind: "chunk",
				chunk: "Confirmed upgrade: RTX 4070",
				similarity: 0.89,
				documentId: "doc-1",
				documentTitle: "GPU update",
				documentType: "text",
			},
		])
	})
})
