/** Reads a text file chosen by the user. UTF-8 first; P6 exports and older Excel CSVs are often Windows-1252. */
export async function readTextFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

/** Project picker default: the project chosen in the top bar, else the first one. */
export const pickProject = (selected: string | null, projects: { id: string }[]) => selected ?? projects[0]?.id ?? "";
