#!/usr/bin/env node
import { spawn } from 'child_process';
import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';

const REFRESH_INTERVAL_MS = 5000;
const SYSTEM_PORT_MAX = 1024;
const COL_PORT = 8;
const COL_PROTO = 6;
const COL_PROCESS_MIN = 10;
const CHROME_ROWS = 8;

type SortKey = 'port' | 'pid' | 'name';
const SORT_CYCLE: SortKey[] = ['port', 'pid', 'name'];

type PortScope = 'all' | 'system' | 'user';
const SCOPE_CYCLE: PortScope[] = ['all', 'system', 'user'];

type ProtoFilter = 'all' | 'tcp' | 'udp';
const PROTO_FILTER_CYCLE: ProtoFilter[] = ['all', 'tcp', 'udp'];

type Proto = 'TCP' | 'UDP';

interface PortEntry {
  port: number;
  pid: string;
  name: string;
  proto: Proto;
}

function shortenProcessName(comm: string): string {
  const lastSlash = comm.lastIndexOf('/');
  return lastSlash === -1 ? comm : comm.slice(lastSlash + 1);
}

function parseLsofOutput(output: string): PortEntry[] {
  const lines = output.trim().split('\n').slice(1);
  const ports: PortEntry[] = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) continue;

    const name = parts[0];
    const pid = parts[1];
    const proto = parts[7] as Proto;
    const addressField = parts[8];

    if (proto !== 'TCP' && proto !== 'UDP') continue;

    // TCP: only LISTEN state; UDP: no state field
    if (proto === 'TCP' && parts[9] !== '(LISTEN)') continue;

    const match = addressField.match(/:(\d+)$/);
    if (!match) continue;

    const port = parseInt(match[1], 10);
    ports.push({ port, pid, name, proto });
  }

  const seen = new Set<string>();
  return ports.filter((p) => {
    const key = `${p.proto}-${p.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fetchProcessNames(pids: string[]): Promise<Map<string, string>> {
  return new Promise((resolve) => {
    if (pids.length === 0) return resolve(new Map());

    const proc = spawn('ps', ['-p', pids.join(','), '-o', 'pid=,comm=']);
    let output = '';

    proc.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    proc.on('close', () => {
      const map = new Map<string, string>();
      for (const line of output.trim().split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const spaceIdx = trimmed.indexOf(' ');
        if (spaceIdx === -1) continue;
        const pid = trimmed.slice(0, spaceIdx).trim();
        const comm = trimmed.slice(spaceIdx + 1).trim();
        map.set(pid, shortenProcessName(comm));
      }
      resolve(map);
    });

    proc.on('error', () => resolve(new Map()));
  });
}

async function fetchPorts(): Promise<PortEntry[]> {
  const ports = await new Promise<PortEntry[]>((resolve) => {
    const proc = spawn('lsof', ['-i', '-P', '-n']);
    let output = '';

    proc.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    proc.on('close', () => resolve(parseLsofOutput(output)));
    proc.on('error', () => resolve([]));
  });

  const pids = [...new Set(ports.map((p) => p.pid))];
  const nameMap = await fetchProcessNames(pids);

  return ports.map((p) => ({
    ...p,
    name: nameMap.get(p.pid) ?? p.name,
  }));
}

function sortPorts(ports: PortEntry[], sortKey: SortKey): PortEntry[] {
  return [...ports].sort((a, b) => {
    if (sortKey === 'port') return a.port - b.port;
    if (sortKey === 'pid') return parseInt(a.pid) - parseInt(b.pid);
    return a.name.localeCompare(b.name);
  });
}

function applyScope(ports: PortEntry[], scope: PortScope): PortEntry[] {
  if (scope === 'system') return ports.filter((p) => p.port <= SYSTEM_PORT_MAX);
  if (scope === 'user') return ports.filter((p) => p.port > SYSTEM_PORT_MAX);
  return ports;
}

function buildScrollbar(trackHeight: number, total: number, offset: number, visible: number): string[] {
  if (total <= visible) return Array(trackHeight).fill(' ');

  const thumbHeight = Math.max(1, Math.round((visible / total) * trackHeight));
  const maxOffset = total - visible;
  const thumbTop = Math.round((offset / maxOffset) * (trackHeight - thumbHeight));

  return Array.from({ length: trackHeight }, (_, i) => {
    if (i >= thumbTop && i < thumbTop + thumbHeight) return '█';
    return '░';
  });
}

function App() {
  const { exit } = useApp();
  const [ports, setPorts] = useState<PortEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isFiltering, setIsFiltering] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('port');
  const [scope, setScope] = useState<PortScope>('user');
  const [protoFilter, setProtoFilter] = useState<ProtoFilter>('all');
  const [scrollOffset, setScrollOffset] = useState(0);
  const maxOffsetRef = useRef(0);

  const terminalRows = process.stdout.rows ?? 24;
  const listHeight = Math.max(1, terminalRows - CHROME_ROWS);

  useInput((input, key) => {
    if (isFiltering) {
      if (key.escape) setIsFiltering(false);
      return;
    }
    if (input === 'q') exit();
    if (input === '/') setIsFiltering(true);
    if (input === 's') {
      setSortKey((prev) => {
        const idx = SORT_CYCLE.indexOf(prev);
        return SORT_CYCLE[(idx + 1) % SORT_CYCLE.length];
      });
    }
    if (input === 't') {
      setScope((prev) => {
        const idx = SCOPE_CYCLE.indexOf(prev);
        return SCOPE_CYCLE[(idx + 1) % SCOPE_CYCLE.length];
      });
      setScrollOffset(0);
    }
    if (input === 'p') {
      setProtoFilter((prev) => {
        const idx = PROTO_FILTER_CYCLE.indexOf(prev);
        return PROTO_FILTER_CYCLE[(idx + 1) % PROTO_FILTER_CYCLE.length];
      });
      setScrollOffset(0);
    }
    if (key.upArrow) {
      setScrollOffset((prev) => Math.max(0, prev - 1));
    }
    if (key.downArrow) {
      setScrollOffset((prev) => Math.min(maxOffsetRef.current, prev + 1));
    }
  });

  const refresh = async () => {
    const result = await fetchPorts();
    setPorts(result);
    setLastUpdated(new Date());
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const filterLower = filter.toLowerCase();
  const filtered = sortPorts(
    applyScope(ports, scope)
    .filter((p) => protoFilter === 'all' || p.proto.toLowerCase() === protoFilter)
    .filter((p) => {
      if (!filterLower) return true;
      return (
        p.name.toLowerCase().includes(filterLower) ||
        p.pid.includes(filterLower) ||
        String(p.port).includes(filterLower) ||
        p.proto.toLowerCase().includes(filterLower)
      );
    }),
    sortKey,
  );

  const maxOffset = Math.max(0, filtered.length - listHeight);

  useLayoutEffect(() => {
    maxOffsetRef.current = maxOffset;
  }, [maxOffset]);

  const clampedOffset = Math.min(scrollOffset, maxOffset);
  const visible = filtered.slice(clampedOffset, clampedOffset + listHeight);
  const scrollbar = buildScrollbar(listHeight, filtered.length, clampedOffset, listHeight);

  const colProcess = Math.max(
    COL_PROCESS_MIN,
    ...filtered.map((p) => p.name.length),
    'PROCESS'.length,
  ) + 2;

  const timeStr = lastUpdated ? lastUpdated.toLocaleTimeString() : 'loading...';
  const needsScroll = filtered.length > listHeight;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">port-monitor</Text>
        <Text color="gray">  scope: </Text>
        <Text color="yellow">{scope}</Text>
        <Text color="gray">  proto: </Text>
        <Text color={protoFilter === 'tcp' ? 'blue' : protoFilter === 'udp' ? 'magenta' : 'gray'}>{protoFilter}</Text>
        <Text color="gray">  sort: </Text>
        <Text color="cyan">{sortKey}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">filter: </Text>
        {isFiltering ? (
          <TextInput
            value={filter}
            onChange={setFilter}
            onSubmit={() => setIsFiltering(false)}
            placeholder="type to filter..."
          />
        ) : (
          <Text color={filter ? 'yellow' : 'gray'}>
            {filter || '(press / to filter)'}
          </Text>
        )}
      </Box>

      <Box flexDirection="column">
        <Box>
          <Text bold color={sortKey === 'port' ? 'cyan' : 'white'}>{padEnd('PORT', COL_PORT)}</Text>
          <Text bold color="white">{padEnd('PROTO', COL_PROTO)}</Text>
          <Text bold color={sortKey === 'name' ? 'cyan' : 'white'}>{padEnd('PROCESS', colProcess)}</Text>
          <Text bold color={sortKey === 'pid' ? 'cyan' : 'white'}>PID</Text>
        </Box>
        <Box>
          <Text color="gray">{'─'.repeat(COL_PORT + COL_PROTO + colProcess + 10)}</Text>
        </Box>
        {filtered.length === 0 ? (
          <Text color="gray">  no matching ports</Text>
        ) : (
          <Box flexDirection="row">
            <Box flexDirection="column">
              {visible.map((p) => (
                <Box key={`${p.proto}-${p.port}`}>
                  <Text color="green">{padEnd(String(p.port), COL_PORT)}</Text>
                  <Text color={p.proto === 'UDP' ? 'magenta' : 'blue'}>{padEnd(p.proto, COL_PROTO)}</Text>
                  <Text color="white">{padEnd(p.name, colProcess)}</Text>
                  <Text color="gray">{p.pid}</Text>
                </Box>
              ))}
            </Box>
            {needsScroll && (
              <Box flexDirection="column" marginLeft={1}>
                {scrollbar.map((ch, i) => (
                  <Text key={i} color={ch === '█' ? 'cyan' : 'gray'}>{ch}</Text>
                ))}
              </Box>
            )}
          </Box>
        )}
      </Box>

      <Box marginTop={1}>
        <Text color="gray">
          {clampedOffset + 1}-{Math.min(clampedOffset + listHeight, filtered.length)}/{filtered.length}
          {'  ·  updated '}{timeStr}
          {'  ·  / filter  s sort  t scope  p proto  ↑↓ scroll  q quit'}
        </Text>
      </Box>
    </Box>
  );
}

function padEnd(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

render(<App />);
