export type CliCommandIdentity = {
  readonly commandName: string;
  readonly version: string;
};

export function cliCommandIdentity(manifest: unknown): CliCommandIdentity {
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    Array.isArray(manifest)
  ) {
    throw new Error("CLI package manifest must be an object");
  }
  const manifestFacts = manifest as Readonly<Record<string, unknown>>;
  if (
    typeof manifestFacts.bin !== "object" ||
    manifestFacts.bin === null ||
    Array.isArray(manifestFacts.bin)
  ) {
    throw new Error("CLI package manifest must declare exactly one bin");
  }
  const binEntries = Object.entries(manifestFacts.bin);
  if (binEntries.length !== 1) {
    throw new Error("CLI package manifest must declare exactly one bin");
  }
  const [commandName, executable] = binEntries[0]!;
  if (executable !== "./dist/cli.js") {
    throw new Error('CLI package manifest bin must execute "./dist/cli.js"');
  }

  let version = "unpublished";
  if (manifestFacts.version !== undefined) {
    if (
      typeof manifestFacts.version !== "string" ||
      manifestFacts.version.length === 0
    ) {
      throw new Error(
        "CLI package manifest version must be a non-empty string when present",
      );
    }
    version = manifestFacts.version;
  }

  return {
    commandName,
    version,
  };
}
