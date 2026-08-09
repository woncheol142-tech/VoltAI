export type KecBatchDirectoryRequest = Readonly<{
  directory: string;
}>;

export type KecBatchDirectoryDiscovery = Readonly<{
  sources: readonly string[];
}>;

export type KecBatchDirectoryDiscoveryDependencies = Readonly<{
  lstat: (path: string) => Readonly<{
    kind: "directory" | "file" | "symlink" | "other";
    identity?: Readonly<{
      device: bigint;
      inode: bigint;
    }>;
  }>;
  realpath: (path: string) => string;
  readDirectory: (path: string) => readonly string[];
}>;
