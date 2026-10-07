import hashlib,json,os,pathlib,subprocess,sys,threading,time,urllib.request,importlib.util
root=pathlib.Path.home()/'containers/fillrate'
spec=importlib.util.spec_from_file_location('region',root/'valhalla/region_check.py');region=importlib.util.module_from_spec(spec);spec.loader.exec_module(region)
def inspect():return json.loads(subprocess.check_output(['docker','inspect','fillrate-valhalla']))[0]
d=inspect();pid=d['State']['Pid'];cg=pathlib.Path('/sys/fs/cgroup')/pathlib.Path(f'/proc/{pid}/cgroup').read_text().strip().split('::')[1].lstrip('/')
ip=next(iter(d['NetworkSettings']['Networks'].values()))['IPAddress'];url=f'http://{ip}:8002'
def reading():
 stats=dict(line.split() for line in (cg/'memory.stat').read_text().splitlines());cpu=dict(line.split() for line in (cg/'cpu.stat').read_text().splitlines())
 return {'at':time.time(),'current':int((cg/'memory.current').read_text()),'anon':int(stats['anon']),'file':int(stats['file']),'cpu_usage_usec':int(cpu['usage_usec'])}
readings=[];end=threading.Event()
def monitor():
 while not end.is_set():readings.append(reading());end.wait(.5)
thread=threading.Thread(target=monitor);thread.start();original=region.post;responses=[]
def post(url,body):
 payload,ms=original(url,body)
 if url.endswith('/sources_to_targets'):
  rows=payload['sources_to_targets'];responses.append({'size':len(rows),'sha256':hashlib.sha256(json.dumps(rows,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'null_pairs':sum(c.get('time') is None for row in rows for c in row),'ms':ms})
 return payload,ms
region.post=post;sys.argv=['region',url,str(root/'valhalla/points-ok7.json'),'--max-block','25']
try:code=region.main()
finally:end.set();thread.join()
report={'label':sys.argv[0],'responses':responses,'peak':max(x['current'] for x in readings),'peak_anon':max(x['anon'] for x in readings),'peak_file':max(x['file'] for x in readings),'before':readings[0],'after':reading(),'cpu_usec':readings[-1]['cpu_usage_usec']-readings[0]['cpu_usage_usec'],'samples':len(readings),'oom_events':(cg/'memory.events').read_text(),'restart':inspect()['RestartCount']}
output=pathlib.Path(os.environ['BENCH_REPORT'])
output.write_text(json.dumps(report,indent=2));print('RESOURCE_REPORT '+json.dumps(report),flush=True)
if any(x['null_pairs'] for x in responses) or not responses or responses[-1]['size']!=25:raise SystemExit('Incomplete 25x25 block')
raise SystemExit(code)
