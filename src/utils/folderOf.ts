/** Folder prefix of a vault path ('' for root notes). Shared by the 008
 *  same-folder cap (discoverSqlite) and the 009 k-NN edge cap. */
export function folderOf(path: string): string {
    const i = path.lastIndexOf('/');
    return i >= 0 ? path.slice(0, i) : '';
}
