export function isModelLineCompatible(
    userTyped: string,
    modelOutput: string,
): boolean {
    if (!userTyped || !modelOutput) return true;
    const userTrimmed = userTyped.trim();
    const modelTrimmed = modelOutput.trim();
    if (!userTrimmed || !modelTrimmed) return true;
    return modelTrimmed.startsWith(userTrimmed) ||
           userTrimmed.startsWith(modelTrimmed);
}
