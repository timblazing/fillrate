// Where "Open" links on public pages go: the static public site only has the sample playground. Server components only.
export const OPEN_HREF = process.env.FILLRATE_STATIC === "1" ? "/playground" : "/scenarios"
