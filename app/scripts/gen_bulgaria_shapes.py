import json, math, sys, re
d = json.load(open(sys.argv[1]))
idmap = {"Grad Sofiya":"sofia-city","Sofia":"sofia-province"}
def rid(n): return idmap.get(n, n.lower().replace(" ","-"))
polys = {}
for f in d["features"]:
    polys[rid(f["properties"]["name"])] = f["geometry"]["coordinates"][0]
# adjacency check
import itertools
pts = {k:set((round(x,2),round(y,2)) for x,y in v) for k,v in polys.items()}
adj = {k:set() for k in polys}
for a,b in itertools.combinations(polys,2):
    if len(pts[a]&pts[b])>=2: adj[a].add(b); adj[b].add(a)
json.dump({k:sorted(v) for k,v in adj.items()}, open("adj.json","w"))
# projection
lat0 = 42.7; k = math.cos(math.radians(lat0))
allp = [p for v in polys.values() for p in v]
minx=min(x*k for x,y in allp); maxx=max(x*k for x,y in allp)
miny=min(-y for x,y in allp); maxy=max(-y for x,y in allp)
W,H=800,500; s=min(W/(maxx-minx),H/(maxy-miny))
def proj(p): return ((p[0]*k-minx)*s,(-p[1]-miny)*s)
def dp(pts,eps):
    if len(pts)<3: return pts
    a,b=pts[0],pts[-1]; dmax=0; idx=0
    for i in range(1,len(pts)-1):
        p=pts[i]; dx,dy=b[0]-a[0],b[1]-a[1]
        L=math.hypot(dx,dy) or 1e-9
        dist=abs(dy*p[0]-dx*p[1]+b[0]*a[1]-b[1]*a[0])/L
        if dist>dmax: dmax,idx=dist,i
    if dmax>eps: return dp(pts[:idx+1],eps)[:-1]+dp(pts[idx:],eps)
    return [a,b]
out={}
for key,v in polys.items():
    ring=[proj(p) for p in v][:-1]
    far=max(range(len(ring)),key=lambda i:math.hypot(ring[i][0]-ring[0][0],ring[i][1]-ring[0][1]))
    pp=dp(ring[:far+1],0.6)[:-1]+dp(ring[far:]+[ring[0]],0.6)[:-1]
    out[key]=[round(c,1) for p in pp for c in p]
w=round((maxx-minx)*s); h=round((maxy-miny)*s)
lines=["// Generated from Natural Earth 1:10m admin-1 boundaries (public domain).","// https://www.naturalearthdata.com/ — see scripts in docs if regenerating.","",
f"export const BULGARIA_SHAPE_SIZE = {{ width: {w}, height: {h} }};","",
"/** Flat [x0, y0, x1, y1, ...] outline per region, in shape-space pixels. */",
"export const BULGARIA_SHAPES: Record<string, number[]> = {"]
for key in sorted(out): lines.append(f'    "{key}": {json.dumps(out[key])},')
lines.append("};")
open("bulgariaShapes.ts","w").write("\n".join(lines)+"\n")
print(w,h,sum(len(v) for v in out.values())//2,"points")
