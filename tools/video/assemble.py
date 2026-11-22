#!/usr/bin/env python3
"""assemble.py out.mp4 item... ; item = file.png:secs or file.mp4. Joins with 0.4 s crossfades, 1080p30 H.264."""
import subprocess, sys, json
out, items = sys.argv[1], sys.argv[2:]
X = 0.4
args, durs = [], []
for it in items:
    if it.endswith('.mp4'):
        d = float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',it]))
        args += ['-i', it]
    else:
        f, d = it.rsplit(':', 1); d = float(d)
        args += ['-loop','1','-framerate','30','-t',str(d),'-i',f]
    durs.append(d)
fl = [f'[{i}:v]scale=1920:1080,fps=30,format=yuv420p,settb=AVTB[v{i}]' for i in range(len(items))]
cur, t = 'v0', durs[0]
for i in range(1, len(items)):
    o = f'x{i}'
    fl.append(f'[{cur}][v{i}]xfade=transition=fade:duration={X}:offset={t - X:.3f}[{o}]')
    cur, t = o, t + durs[i] - X
fl.append(f'[{cur}]fade=t=in:st=0:d=0.3,fade=t=out:st={t-0.5:.3f}:d=0.5[out]')
subprocess.check_call(['ffmpeg','-y','-loglevel','error',*args,'-filter_complex',';'.join(fl),'-map','[out]','-c:v','libx264','-preset','slow','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart','-r','30',out])
print(out, round(t, 1), 's')
