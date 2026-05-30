function normalizeBuildValue(value: string | undefined): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export const BUILD_INFO = {
	commitSha: normalizeBuildValue(process.env.BUILD_COMMIT_SHA),
	branch: normalizeBuildValue(process.env.BUILD_BRANCH),
	tag: normalizeBuildValue(process.env.BUILD_TAG),
	message: normalizeBuildValue(process.env.BUILD_MESSAGE),
	date: normalizeBuildValue(process.env.BUILD_DATE),
};
