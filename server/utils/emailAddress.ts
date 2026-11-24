/** RFC 2606 / 6761 reserved domains that must never receive real email. */
export const isTestAddress = (email: string) => /@([^@]+\.)?(test|local|invalid|localhost|example)$|@example\.(com|org|net)$/i.test(email.trim());

/**
 * Broadcasts (alerts to every user with a permission, or to every agency) reach only the automated tests' own users
 * (addresses ending in .test) while the tests run, so a test run never emails or notifies the real people in the
 * database, including the first admin whose address may end in .local.
 */
export const broadcastAllowed = (email: string) => process.env.NODE_ENV !== "test" || /\.test$/i.test(email.trim());
