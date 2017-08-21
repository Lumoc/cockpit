#! /usr/bin/python

# nfs-mounts   --  Monitor and manage NFS mounts
#
# This is similar to how UDisks2 monitors and manages block device
# mounts, but for NFS.  This might be moved into UDisks2, or not.

import select
import re
import sys
import json

import os
import ctypes
import struct
import subprocess
import traceback

# We monitor all NFS remotes listed in /etc/fstab and in /etc/mtab.
# If a entry from mtab is also found in fstab, we report only the
# fstab entry and mark it is "mounted".

IN_CLOSE_WRITE = 0x00000008
IN_IGNORED     = 0x00008000

class Inotify:
    def __init__(self):
        self._libc = ctypes.CDLL(None, use_errno=True)
        self._get_errno_func = ctypes.get_errno

        self._libc.inotify_init.argtypes = []
        self._libc.inotify_init.restype = ctypes.c_int
        self._libc.inotify_add_watch.argtypes = [ctypes.c_int, ctypes.c_char_p,
                                                 ctypes.c_uint32]
        self._libc.inotify_add_watch.restype = ctypes.c_int
        self._libc.inotify_rm_watch.argtypes = [ctypes.c_int, ctypes.c_int]
        self._libc.inotify_rm_watch.restype = ctypes.c_int

        self.fd = self._libc.inotify_init()

    def add_watch(self, path, mask):
        path = ctypes.create_string_buffer(path.encode(sys.getfilesystemencoding()))
        wd = self._libc.inotify_add_watch(self.fd, path, mask)
        if wd < 0:
            sys.stderr.write("can't add watch for %s: %s\n" % (path, os.strerror(self._get_errno_func())))
        return wd

    def rem_watch(self, wd):
        if self._libc.inotify_rm_watch(self.fd, wd) < 0:
            sys.stderr.write("can't remove watch: %s\n" % (os.strerror(self._get_errno_func())))

    def process(self, callback):
        buf = os.read(self.fd, 4096)
        pos = 0
        while pos < len(buf):
            (wd, mask, cookie, name_len) = struct.unpack('iIII', buf[pos:pos+16])
            pos += 16
            (name,) = struct.unpack('%ds' % name_len, buf[pos:pos + name_len])
            pos += name_len
            callback(wd, mask, name.decode().rstrip('\0'))

class Watcher:
    def __init__(self, path):
        self.inotify = Inotify()
        self.path = path
        self.setup()

    def setup(self):
        self.wd = self.inotify.add_watch(self.path, IN_CLOSE_WRITE)

    def process(self, callback = None):
        def event(wd, mask, name):
            if callback:
                callback()
            if mask & IN_IGNORED:
                self.setup()
        self.inotify.process(event)

def field_escape(str):
    return str.replace("\\", "\\134").replace(" ", "\\040").replace("\t", "\\011")

def field_unescape(str):
    return re.sub("\\\\([0-7]{1,3})", lambda m: chr(int(m.group(1), 8)), str)

def parse_tab(name):
    entries = [ ]
    for line in open(name, "r").read().split("\n"):
        sline = line.strip()
        if sline == "" or sline[0] == "#":
            continue
        fields = list(map(field_unescape, re.split("[ \t]+", sline)))
        if len(fields) > 0 and ":" in fields[0]:
            entries.append(fields)
    return entries

def index_tab(tab):
    by_remote = { }
    for t in tab:
        if not t[0] in by_remote:
            by_remote[t[0]] = [ ]
        by_remote[t[0]].append(t)
    return by_remote

def modify_tab(name, modify):
    lines = open(name, "r").read().split("\n")
    if len(lines) > 0 and lines[len(lines)-1] == "":
        del lines[len(lines)-1]

    new_lines = [ ]
    for line in lines:
        sline = line.strip()
        if sline == "" or sline[0] == "#":
            new_lines.append(line)
        else:
            fields = list(map(field_unescape, re.split("[ \t]+", sline)))
            if len(fields) > 0 and ":" in fields[0]:
                new_fields = modify(fields)
                if new_fields:
                    if new_fields == fields:
                        new_lines.append(line)
                    else:
                        new_lines.append(" ".join(map(field_escape, new_fields)))
            else:
                new_lines.append(line)
    new_fields = modify(None)
    if new_fields:
        new_lines.append(" ".join(map(field_escape, new_fields)))

    f = open(name + ".tmp", "w")
    f.write("\n".join(new_lines) + "\n")
    f.flush()
    os.fsync(f.fileno())
    f.close()
    os.rename(name + ".tmp", name)

fstab = [ ]
fstab_by_remote = { }

mtab = [ ]
mtab_by_remote = { }

def process_fstab():
    global fstab, fstab_by_remote
    fstab = parse_tab("/etc/fstab")
    fstab_by_remote = index_tab(fstab)

def process_mtab():
    global mtab, mtab_by_remote
    mtab = parse_tab("/etc/mtab")
    mtab_by_remote = index_tab(mtab)

def find_in_tab(tab_by_remote, fields):
    for t in tab_by_remote.get(fields[0], [ ]):
        if t[0] == fields[0] and t[1] == fields[1]:
            return t
    return None

def report():
    data = [ ]
    for f in fstab:
        m = find_in_tab(mtab_by_remote, f)
        data.append({ "fstab": True, "fields": f, "mounted": m is not None })
    for m in mtab:
        if not find_in_tab(fstab_by_remote, m):
            data.append({ "fstab": False, "fields": m, "mounted": True })
    sys.stdout.write(json.dumps(data) + "\n")
    sys.stdout.flush()

def monitor():
    process_mtab()
    process_fstab()
    report()
    fstab_watcher = Watcher("/etc/fstab")
    mtab_file = open("/proc/mounts", "r")
    while True:
        (r, w, x) = select.select([ fstab_watcher.inotify.fd ], [ ], [ mtab_file ])
        if mtab_file in x:
            process_mtab()
            report()
        if fstab_watcher.inotify.fd in r:
            fstab_watcher.process()
            process_fstab()
            report()

def mkdir_if_necessary(path):
    if not os.path.isdir(path):
        os.makedirs(path)

def rmdir_if_empty(path):
    try:
        os.rmdir(path)
    except OSError as e:
        if e.errno != errno.ENOTEMPTY:
            raise

def update(entry, new_fields):
    old_fields = entry["fields"]
    mkdir_if_necessary(new_fields[1])
    modify_tab("/etc/fstab", lambda fields: new_fields if fields == old_fields else fields)
    if entry["mounted"]:
        if (new_fields[0] == old_fields[0]
            and new_fields[1] == old_fields[1]
            and new_fields[2] == old_fields[2]):
            remount(new_fields)
        else:
            try:
                unmount(entry)
                rmdir_if_empty(old_fields[1])
            except subprocess.CalledProcessError:
                pass
            mount({ "fields": new_fields })
    else:
        rmdir_if_empty(old_fields[1])

def add(new_fields):
    mkdir_if_necessary(new_fields[1])
    modify_tab("/etc/fstab", lambda fields: new_fields if fields is None else fields)
    mount({ "fields": new_fields })

def remove(entry):
    old_fields = entry["fields"]
    if entry["mounted"]:
        unmount(entry)
    rmdir_if_empty(old_fields[1])
    modify_tab("/etc/fstab", lambda fields: None if fields == old_fields else fields)

def mount(entry):
    fields = entry["fields"]
    subprocess.check_call([ "mount",
                            "-t", fields[2],
                            "-o", fields[3],
                            fields[0],
                            fields[1] ])

def remount(fields):
    subprocess.check_call([ "mount",
                            "-o", "remount," + fields[3],
                            fields[0],
                            fields[1] ])

def unmount(entry):
    subprocess.check_call([ "umount", entry["fields"][1] ])

def fuser(entry):

    import dbus
    bus = dbus.SystemBus()
    systemd_manager = dbus.Interface(bus.get_object('org.freedesktop.systemd1', '/org/freedesktop/systemd1'),
                                     dbus_interface='org.freedesktop.systemd1.Manager')

    if not entry["mounted"]:
        return { }

    mount_point = entry["fields"][1]
    results = { }

    def check(path, pid):
        t = os.readlink(path)
        if t == mount_point or t.startswith(mount_point + "/"):
            unit = systemd_manager.GetUnitByPID(int(pid))
            if unit not in results:
                unit_obj = bus.get_object('org.freedesktop.systemd1', unit)
                desc = unit_obj.Get("org.freedesktop.systemd1.Unit", "Description",
                                    dbus_interface="org.freedesktop.DBus.Properties")
                id = unit_obj.Get("org.freedesktop.systemd1.Unit", "Id",
                                  dbus_interface="org.freedesktop.DBus.Properties")
                results[unit] = { "unit": id, "desc": desc }
            return True
        return False

    def checkdir(path, pid):
        for f in os.listdir(path):
            if check(os.path.join(path, f), pid):
                return True
        return False

    my_pid = os.getpid()

    for p in os.listdir("/proc/"):
        if not p.isdigit():
            continue
        if int(p) == my_pid:
            continue
        proc = "/proc/%s/" % p
        try:
            if check(proc + "exe", p): continue
            if check(proc + "root", p): continue
            if check(proc + "cwd", p): continue
            if checkdir(proc + "fd", p): continue
            if checkdir(proc + "map_files", p): continue
        except OSError:
            pass

    return list(results.values())

def users(entry):
    data = fuser(entry)
    sys.stdout.write(json.dumps(data) + "\n")
    sys.stdout.flush()

def stop_units(units):
    import dbus
    bus = dbus.SystemBus()
    systemd_manager = dbus.Interface(bus.get_object('org.freedesktop.systemd1', '/org/freedesktop/systemd1'),
                                     dbus_interface='org.freedesktop.systemd1.Manager')
    for u in units:
        systemd_manager.StopUnit(u, 'replace')

def stop_and_unmount(units, entry):
    stop_units(units)
    unmount(entry)

def stop_and_remove(units, entry):
    stop_units(units)
    remove(entry)

def dispatch(argv):
    if argv[1] == "monitor":
        monitor()
    elif argv[1] == "update":
        update(json.loads(argv[2]), json.loads(argv[3]))
    elif argv[1] == "add":
        add(json.loads(argv[2]))
    elif argv[1] == "remove":
        remove(json.loads(argv[2]))
    elif argv[1] == "mount":
        mount(json.loads(argv[2]))
    elif argv[1] == "unmount":
        unmount(json.loads(argv[2]))
    elif argv[1] == "stop-and-unmount":
        stop_and_unmount(json.loads(argv[2]), json.loads(argv[3]))
    elif argv[1] == "stop-and-remove":
        stop_and_remove(json.loads(argv[2]), json.loads(argv[3]))
    elif argv[1] == "users":
        users(json.loads(argv[2]))

try:
    dispatch(sys.argv)
except subprocess.CalledProcessError as e:
    sys.exit(e.returncode)
except:
    sys.stderr.write("".join(traceback.format_exception_only(sys.exc_info()[0], sys.exc_info()[1])))
    sys.stderr.flush()
    sys.exit(1)
