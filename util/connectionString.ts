export function formatConnectionStringForLogging(connectionString: string) {
  const connectionStringParsed = new URL(connectionString);
  const connectionStringInfo = `${connectionStringParsed.protocol ? `${connectionStringParsed.protocol}//` : ""}${connectionStringParsed.username ? `${connectionStringParsed.username}@` : ""}${connectionStringParsed.hostname}:${connectionStringParsed.port}${connectionStringParsed.pathname}`;
  return connectionStringInfo;
}
