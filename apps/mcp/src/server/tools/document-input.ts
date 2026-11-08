import { z } from "zod"
import { effectiveNamespaceAccess } from "../auth/rbac"
import type { ToolDeps } from "./types"

export const documentIdSchema = z.string().min(1).max(255)
export const metadataSchema = z.record(
	z.string(),
	z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.string())]),
)
export const documentFields = {
	metadata: metadataSchema.optional(),
	group: metadataSchema.optional(),
	date: z.union([z.iso.date(), z.iso.datetime({ offset: true })]).optional(),
	supportingContext: z.string().max(1500).optional(),
}
export const ingestionFields = {
	taskType: z
		.enum(["memory", "superrag"])
		.optional()
		.describe(
			"superrag indexes source passages without extracting memories; memory forms learned facts.",
		),
	dreaming: z
		.enum(["instant", "dynamic"])
		.optional()
		.describe(
			"instant bills an extra operation per document; omit for normal bulk ingestion.",
		),
}

export async function requireWriteAccess(deps: ToolDeps, namespace: string) {
	const session = await deps.getSession()
	const [access] = effectiveNamespaceAccess([namespace], session)
	if (access?.permission !== "write") {
		throw new Error(`Write access is required for space "${namespace}".`)
	}
}
