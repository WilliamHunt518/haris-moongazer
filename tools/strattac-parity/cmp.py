import sys
a=open(sys.argv[1]).read().split('\n'); b=open(sys.argv[2]).read().split('\n')
a=[x for x in a if x]; b=[x for x in b if x]
print(len(a),len(b))
bad=0
for x,y in zip(a,b):
    fx=x.replace(';','|').replace(',','|').split('|'); fy=y.replace(';','|').replace(',','|').split('|')
    ok=len(fx)==len(fy)
    if ok:
        for p,q in zip(fx,fy):
            try:
                if float(p)!=float(q): ok=False
            except ValueError:
                if p!=q: ok=False
    if not ok:
        bad+=1
        if bad<4: print('DIFF\n',x,'\n',y)
print('mismatches',bad)
