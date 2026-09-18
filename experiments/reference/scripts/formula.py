import collections, glob, os
for f in sorted(glob.glob("*.xyz")):
    lines = open(f).read().splitlines()
    n = int(lines[0]); syms = [l.split()[0] for l in lines[2:2+n]]
    c = collections.Counter(syms)
    parts = []
    for e in ["C", "H", "N", "O"]:
        if c[e]:
            parts.append(e + (str(c[e]) if c[e] > 1 else ""))
    print("%-14s n=%3d  %s" % (os.path.splitext(f)[0], n, "".join(parts)))
