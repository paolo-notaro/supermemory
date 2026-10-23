import { z } from "zod"
import { getMemoryText } from "../client"
import { optionalNamespaceSchema } from "../namespace"
import {
	legacyNamespaceInput,
	namespaceArg,
	withLegacyNamespace,
} from "./compat"
import { READ_ONLY_TOOL_ANNOTATIONS } from "./annotations"
import {
	searchMemoryOutputSchema,
	type SearchMemoryOutput,
} from "./output-schemas"
import { textContent, type ToolDeps } from "./types"

export function register(deps: ToolDeps) {
	const inputSchema = z.object({
		query: z
			.string()
			.max(1000, "Query exceeds maximum length")
			.describe("The search query to find relevant memories"),
		searchMode: z
			.enum(["memories", "hybrid", "chunks"])
			.optional()
			.describe(
				"Search extracted memories (default), both memories and source passages (hybrid), or source passages only (chunks).",
			),
		namespace: optionalNamespaceSchema,
		...legacyNamespaceInput,
	})

	deps.server.registerTool(
		"search_memory",
		{
			description:
				"Search one space with a natural-language query. The default returns extracted memories only; choose hybrid to search both memories and source passages, or chunks for source passages only. Results include their kind and available source-document provenance. If you need who-the-user-is, preferences, or recent context after searching, call get_profile. When the user names a space, resolve it with list_spaces and pass namespace; otherwise use the active space.",
			inputSchema,
			outputSchema: searchMemoryOutputSchema,
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
		},
		async (args) => {
			try {
				const namespace = await deps.resolveNamespace(namespaceArg(args))
				const client = deps.getClient(namespace)

				const searchResult = args.searchMode
					? await client.search(args.query, 10, args.searchMode)
					: await client.search(args.query)
				const results = searchResult.results.map((result) => ({
					id: result.id,
					kind: result.kind,
					text: getMemoryText(result),
					similarity: result.similarity,
					...(result.documentId && { documentId: result.documentId }),
					...(result.documentTitle !== undefined && {
						documentTitle: result.documentTitle,
					}),
					...(result.documentType !== undefined && {
						documentType: result.documentType,
					}),
				}))

				const parts: string[] = []
				if (searchResult.results.length > 0) {
					parts.push(
						args.searchMode === "hybrid"
							? "## Matching memories and source passages"
							: args.searchMode === "chunks"
								? "## Matching source passages"
								: "## Matching memories",
					)
					for (const result of searchResult.results) {
						const text = getMemoryText(result)
						const similarity = (result.similarity * 100).toFixed(0)
						const documentDetails = [
							result.documentId,
							result.documentTitle,
							result.documentType,
						].filter((value): value is string => Boolean(value))
						const source = documentDetails.length
							? ` (document: ${documentDetails.join(" | ")})`
							: ""
						const kind = args.searchMode
							? `${result.kind === "chunk" ? "source passage" : "memory"}: `
							: ""
						parts.push(
							`- ${result.id} [${similarity}%] ${kind}${text}${source}`,
						)
					}
				} else {
					parts.push("No matching memories found.")
				}

				const structuredContent: SearchMemoryOutput = withLegacyNamespace({
					query: args.query,
					namespace,
					results,
					total: searchResult.total,
					timing: searchResult.timing,
				})

				return {
					content: [textContent(parts.join("\n"))],
					structuredContent,
				}
			} catch (error) {
				return deps.errorResult(error)
			}
		},
	)
}
