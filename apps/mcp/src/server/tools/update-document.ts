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

export const updateDocumentInputSchema = z
	.object({
		namespace: optionalNamespaceSchema,
		...legacyNamespaceInput,
		documentId: documentIdSchema,
		content: z.string().min(1).max(200000).optional(),
		...documentFields,
		...ingestionFields,
	})
	.refine(
		(args) =>
			[
				args.content,
				args.metadata,
				args.group,
				args.date,
				args.supportingContext,
			].some((value) => value !== undefined),
		{
			message:
				"Supply content, metadata, group, date or supportingContext; processing controls alone do not update a document",
		},
	)

export function register(deps: ToolDeps) {
	deps.server.registerTool(
		"update_document",
		{
			title: "Update Document",
			description:
				"Update an existing source document in one space. Supplied content REPLACES the source in place, preserving its ID; omitted fields remain unchanged. Read the live canonical vault note before replacing its indexed copy. This differs from add_memory, which appends. Poll the returned ID; queued is not finished. A missing document is an error, not an implicit creation.",
			inputSchema: updateDocumentInputSchema,
			outputSchema: z.object({
				namespace: z.string(),
				containerTag: z.string().optional(),
				success: z.boolean(),
				id: z.string(),
				status: z.string(),
			}),
			annotations: MEMORY_TOOL_ANNOTATIONS,
		},
		async (args) => {
			try {
				const namespace = await deps.resolveNamespace(namespaceArg(args))
				await requireWriteAccess(deps, namespace)
				const {
					documentId,
					namespace: _namespace,
					containerTag: _containerTag,
					...request
				} = args
				const result = await deps
					.getClient(namespace)
					.updateDocument(documentId, request)
				return {
					content: [
						textContent(
							`Document ${result.id} updated (${result.status}); verify processing status.`,
						),
					],
					structuredContent: withLegacyNamespace({ ...result, success: true }),
				}
			} catch (error) {
				return deps.errorResult(error)
			}
		},
	)
}
