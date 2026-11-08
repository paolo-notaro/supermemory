import { z } from "zod"
import { optionalNamespaceSchema } from "../namespace"
import {
	legacyNamespaceInput,
	namespaceArg,
	withLegacyNamespace,
} from "./compat"
import { MEMORY_TOOL_ANNOTATIONS } from "./annotations"
import {
	documentFields,
	documentIdSchema,
	ingestionFields,
	requireWriteAccess,
} from "./document-input"
import { textContent, type ToolDeps } from "./types"

export const batchDocumentsInputSchema = z
	.object({
		namespace: optionalNamespaceSchema,
		...legacyNamespaceInput,
		documents: z
			.array(
				z.object({
					documentId: documentIdSchema,
					content: z.string().min(1).max(200000),
					...documentFields,
				}),
			)
			.min(1)
			.max(600),
		...ingestionFields,
		taskType: ingestionFields.taskType.default("superrag"),
	})
	.superRefine((args, context) => {
		const ids = new Set<string>()
		let characters = 0
		for (const [index, document] of args.documents.entries()) {
			characters += document.content.length
			if (ids.has(document.documentId))
				context.addIssue({
					code: "custom",
					path: ["documents", index, "documentId"],
					message: "Duplicate documentId in batch",
				})
			ids.add(document.documentId)
		}
		if (characters > 2000000)
			context.addIssue({
				code: "custom",
				path: ["documents"],
				message:
					"Batch exceeds 2,000,000 content characters; split into smaller batches",
			})
	})

const resultSchema = z.object({
	id: z.string(),
	status: z.string(),
	error: z.string().optional(),
	details: z.string().optional(),
	url: z.string().optional(),
})

export function register(deps: ToolDeps) {
	deps.server.registerTool(
		"batch_add_documents",
		{
			title: "Batch Add Documents",
			description:
				"Ingest 1–600 documents into one space in one API call (up to 2M content characters). Defaults to superrag: source indexing without learned-memory extraction. Use stable documentId values and source metadata/date. Reusing an ID appends; use update_document to replace a note. Read every per-ID result: acceptance is not completed processing. After an ambiguous failure, check existing IDs before retrying; never blindly replay a batch.",
			inputSchema: batchDocumentsInputSchema,
			outputSchema: z.object({
				namespace: z.string(),
				containerTag: z.string().optional(),
				success: z.boolean(),
				count: z.number(),
				failed: z.number(),
				results: z.array(resultSchema),
			}),
			annotations: MEMORY_TOOL_ANNOTATIONS,
		},
		async (args) => {
			try {
				const namespace = await deps.resolveNamespace(namespaceArg(args))
				await requireWriteAccess(deps, namespace)
				const result = await deps.getClient(namespace).addDocumentsBatch({
					documents: args.documents.map(({ documentId, ...document }) => ({
						...document,
						id: documentId,
					})),
					taskType: args.taskType,
					...(args.dreaming && { dreaming: args.dreaming }),
				})
				return {
					content: [
						textContent(
							`Batch accepted ${result.count} documents; ${result.failed} failed. Poll document statuses before relying on retrieval.`,
						),
					],
					structuredContent: withLegacyNamespace({
						...result,
						success: result.failed === 0,
					}),
				}
			} catch (error) {
				return deps.errorResult(error)
			}
		},
	)
}
