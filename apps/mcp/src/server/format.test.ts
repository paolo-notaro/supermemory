import { describe, expect, it } from "vitest"
import type { DocumentDetails, DocumentsListResponse } from "./client"
import { formatDocument, formatDocumentsList } from "./format"

describe("document processing statuses", () => {
	it("labels memory extraction separately in document lists", () => {
		const response = {
			documents: [
				{
					id: "doc-1",
					title: "GPU update",
					type: "text",
					status: "done",
					dreamingStatus: "dreaming",
					createdAt: "2026-10-20T17:06:00.000Z",
					updatedAt: "2026-10-20T17:06:00.000Z",
					summary: null,
					url: null,
				},
			],
			pagination: {
				currentPage: 1,
				limit: 10,
				totalItems: 1,
				totalPages: 1,
			},
		} satisfies DocumentsListResponse

		expect(formatDocumentsList(response)).toContain(
			"text, done, memory extraction: dreaming",
		)
	})

	it("shows both statuses for one document", () => {
		const document = {
			id: "doc-1",
			title: "GPU update",
			type: "text",
			summary: null,
			content: "Synthetic benchmark content",
			system: {
				status: "done",
				dreamingStatus: "dreaming",
				createdAt: "2026-10-20T17:06:00.000Z",
				updatedAt: "2026-10-20T17:06:00.000Z",
			},
		} as DocumentDetails

		const formatted = formatDocument(document)
		expect(formatted).toContain("Status: done")
		expect(formatted).toContain("Memory extraction status: dreaming")
	})
})
