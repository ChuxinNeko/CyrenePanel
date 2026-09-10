/**
 * /proc/mounts 解析与过滤。
 *
 * 单独成模块是因为这段是纯逻辑、无任何副作用，可以脱离 Linux 环境
 * 直接喂数据验证；放在 system/index.ts 里会连带把数据库等一起初始化。
 */

/**
 * /proc/mounts 里绝大多数条目并不是"磁盘"，直接列出来会淹没真正的挂载点。
 * 典型噪声是 snap：每装一个包就有一个 squashfs 只读镜像挂在 /dev/loopN 上，
 * 容量恒等于镜像大小、占用率永远 100%，一台机器几十条。
 */
const PSEUDO_FILESYSTEMS = new Set([
  "squashfs", "tmpfs", "devtmpfs", "ramfs", "overlay", "aufs",
  "proc", "sysfs", "cgroup", "cgroup2", "devpts", "mqueue",
  "hugetlbfs", "debugfs", "tracefs", "securityfs", "pstore",
  "bpf", "configfs", "fusectl", "autofs", "binfmt_misc",
  "efivarfs", "nsfs", "rpc_pipefs", "selinuxfs", "iso9660", "udf",
]);

/** 非 /dev/ 开头但确实占物理或网络容量的文件系统，例如 ZFS 池和 NAS 挂载 */
const REAL_NON_DEV_FILESYSTEMS = new Set([
  "zfs", "nfs", "nfs4", "cifs", "fuseblk", "fuse.sshfs",
]);

export interface MountEntry {
  device: string;
  mount: string;
  /** 文件系统类型，如 ext4 / xfs / vfat */
  fstype: string;
}

/** /proc/mounts 会把空格等字符写成八进制转义 */
function unescapeMountField(value: string): string {
  return value.replace(/\\([0-7]{3})/g, (_, oct) =>
    String.fromCharCode(parseInt(oct, 8)),
  );
}

/** 从 /proc/mounts 内容里挑出真实的块设备挂载点 */
export function parseLinuxMounts(content: string): MountEntry[] {
  const mounts: MountEntry[] = [];
  const seen = new Set<string>();

  for (const line of content.split("\n")) {
    const parts = line.split(" ");
    // 字段依次是 设备 挂载点 类型 选项 …
    if (parts.length < 3) continue;
    const device = unescapeMountField(parts[0]);
    const mount = unescapeMountField(parts[1]);
    const fstype = parts[2];

    if (PSEUDO_FILESYSTEMS.has(fstype)) continue;
    // snap 和各类只读镜像都挂在 loop 设备上
    if (/^\/dev\/loop\d+$/.test(device)) continue;
    // 真实块设备，或 ZFS / 网络挂载这类不走 /dev 的
    if (!device.startsWith("/dev/") && !REAL_NON_DEV_FILESYSTEMS.has(fstype)) continue;
    if (seen.has(mount)) continue;

    seen.add(mount);
    mounts.push({ device, mount, fstype });
  }

  return mounts;
}
