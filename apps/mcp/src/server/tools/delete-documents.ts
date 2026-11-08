import { z } from "zod"
import { optionalNamespaceSchema } from "../namespace"
import {
	legacyNamespaceInput,
	namespaceArg,
	withLegacyNamespace,
} from "./compat"
import { MEMORY_TOOL_ANNOTATIONS } from "./annotations"
import { documentIdSchema, requireWriteAccess } from "./document-input"
import { textContent, type ToolDeps } from "./types"

export const deleteDocumentsInputSchema = z.object({
	namespace: optionalNamespaceSchema,
	...legacyNamespaceInput,
	documentIds: z
		.array(documentIdSchema)
		.min(1)
		.max(100)
		.refine(
			(ids) => new Set(ids).size === ids.length,
			"Duplicate document IDs",
		),
})

export function register(deps: ToolDeps) {
	deps.server.registerTool(
		"delete_documents",
		{
			title: "Delete Source Documents",
			description:
				"Delete 1–100 source documents by exact document IDs in one space. Destructive: use only for user-authorized removal/cleanup after verifying IDs with list_documents/get_document. This deletes source documents; forget_memory only forgets extracted facts. Inspect per-ID errors; successful deletions are not rolled back. Do not delete canonical vault files.",
			inputSchema: deleteDocumentsInputSchema,
			outputSchema: z.object({
				namespace: z.string(),
				containerTag: z.string().optional(),
				success: z.boolean(),
				count: z.number(),
				errors: z.array(z.object({ id: z.string(), error: z.string() })),
			}),
			annotations: MEMORY_TOOL_ANNOTATIONS,
		},
		async (args) => {
			try {
				const namespace = await deps.resolveNamespace(namespaceArg(args))
				await requireWriteAccess(deps, namespace)
				const result = await deps
					.getClient(namespace)
					.deleteDocuments(args.documentIds)
				return {
					content: [
						textContent(
							`Deleted ${result.count} source documents; ${result.errors.length} failed.`,
						),
					],
					structuredContent: withLegacyNamespace({
						...result,
						success: result.errors.length === 0,
					}),
				}
			} catch (error) {
				return deps.errorResult(error)
			}
		},
	)
}
