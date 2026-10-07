import json,pathlib,subprocess,time
p=pathlib.Path('/tmp/fillrate-valhalla-after-repeat.json');done=json.loads(p.read_text())['after']['at']
def inspect():return json.loads(subprocess.check_output(['docker','inspect','fillrate-valhalla']))[0]
d=inspect();pid=d['State']['Pid'];cg=pathlib.Path('/sys/fs/cgroup')/pathlib.Path(f'/proc/{pid}/cgroup').read_text().strip().split('::')[1].lstrip('/')
result=[]
def read(label):
 stats=dict(x.split() for x in (cg/'memory.stat').read_text().splitlines()); cpu=dict(x.split() for x in (cg/'cpu.stat').read_text().splitlines()); mem=dict((x.split()[0].rstrip(':'),int(x.split()[1])) for x in pathlib.Path('/proc/meminfo').read_text().splitlines() if len(x.split())>1)
 proc=subprocess.check_output(['docker','exec','fillrate-valhalla','cat','/proc/1/smaps_rollup'],text=True);process={x.split(':')[0]:int(x.split()[1])*1024 for x in proc.splitlines() if x.startswith(('Rss:','Pss:','Anonymous:','Swap:'))}
 row={'label':label,'elapsed_after_repeat_s':round(time.time()-done,1),'current':int((cg/'memory.current').read_text()),'anon':int(stats['anon']),'file':int(stats['file']),'cpu_usage_usec':int(cpu['usage_usec']),'host_available':mem['MemAvailable']*1024,'process_bytes':process,'oom_events':(cg/'memory.events').read_text(),'restart':inspect()['RestartCount']}
 result.append(row);pathlib.Path('/tmp/fillrate-valhalla-idle.json').write_text(json.dumps(result,indent=2));print(json.dumps(row),flush=True)
read('immediate')
for seconds in [60,300]:
 while time.time()<done+seconds:time.sleep(min(1,max(.01,done+seconds-time.time())))
 read(f'{seconds}s')
