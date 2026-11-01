// The page's side of worker.js: questions go to the worker, and answers come
// back as promises. A worker busy searching can't read a message, so a question
// nobody wants any more is dropped by ending the worker, and a new one starts
// for the next question. If a worker can't start, or goes silent, the page
// answers with the same code on a short budget instead: a weaker move, and a
// moment's stall, but the game goes on. Such an answer says `onPage`.
//
// A search can take minutes, so it isn't timed. It reports several times a
// second, and only silence counts against it.
//
// With ?think=here in the address the page always answers itself, on a small
// fixed budget: the test driver's simulated clock doesn't wait for workers.
// ?think=broken pretends no worker can start.

import { answer } from './ai.js';

const params = new URLSearchParams(location.search);
const mode = params.get('think');
const HERE_LIMIT = { nodes: 20000 }; // the driver's budget: the same answer every run
const FALLBACK_LIMIT = { ms: 400 }; // a real page, doing without a worker
const PAINT_MS = 30; // lets "thinking" reach the screen before the page stalls
const SILENCE_MS = 7000; // a search reports far more often, so a worker this quiet has died
const SECOND_CHANCE_MS = 2000; // a phone waking up can run this timer before the worker's messages

let worker = null;
let broken = mode === 'here' || mode === 'broken'; // no point trying to start one
let job = null; // the question in hand: one at a time, the rest wait
const waiting = [];
let nextId = 1;

function thinkHere(request) {
  const limit = mode === 'here' ? HERE_LIMIT : FALLBACK_LIMIT;
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve({ ...answer({ ...request, limit }), onPage: true });
      } catch (error) {
        reject(error);
      }
    }, PAINT_MS);
  });
}

function endWorker() {
  worker?.terminate();
  worker = null;
}

// Gives up on workers for the rest of this page, and answers what's left here.
function giveUp() {
  endWorker();
  broken = true;
  const left = [...(job ? [job] : []), ...waiting.splice(0)];
  job = null;
  for (const { request, resolve, reject, silence } of left) {
    clearTimeout(silence);
    thinkHere(request).then(resolve, reject);
  }
}

// This worker has stopped answering: the page takes this question, and the
// next one gets a new worker.
function abandon() {
  const { request, resolve, reject } = job;
  job = null;
  endWorker();
  thinkHere(request).then(resolve, reject);
  nextJob();
}

// Waits to hear from the worker on `current`, and hears nothing twice before
// abandoning it. A hidden page may just be asleep, so it waits on.
function listen(current, wait = SILENCE_MS) {
  clearTimeout(current.silence);
  current.silence = setTimeout(() => {
    if (current !== job) return;
    if (document.hidden) listen(current);
    else if (wait === SILENCE_MS) listen(current, SECOND_CHANCE_MS);
    else abandon();
  }, wait);
}

function startWorker() {
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
    return false;
  }
  worker.onmessage = ({ data }) => {
    if (data.id !== job?.id) return;
    if ('progress' in data) {
      listen(job);
      job.onProgress?.(data.progress);
      return;
    }
    const { resolve, reject, silence } = job;
    clearTimeout(silence);
    job = null;
    if ('error' in data) reject(new Error(data.error));
    else resolve(data.result);
    nextJob();
  };
  worker.onerror = giveUp;
  return true;
}

function nextJob() {
  if (job || !waiting.length) return;
  if (!worker && !startWorker()) {
    giveUp();
    return;
  }
  job = waiting.shift();
  job.id = nextId++;
  listen(job);
  worker.postMessage({ id: job.id, request: job.request });
}

// Worth doing at load, so the first question doesn't also start the worker.
export function startThinker() {
  if (!broken && !worker) startWorker();
}

// Answers `request`, as answer() in ai.js takes them. `onProgress` hears how
// a search is going, if a worker is doing it.
export function ask(request, onProgress = null) {
  if (broken) return thinkHere(request);
  return new Promise((resolve, reject) => {
    waiting.push({ request, resolve, reject, onProgress });
    nextJob();
  });
}

// Drops every question in hand: they reject, so whoever asked must handle that.
export function cancelThinking() {
  for (const { reject } of waiting.splice(0)) reject(new Error('cancelled'));
  if (!job) return;
  const { reject, silence } = job;
  clearTimeout(silence);
  job = null;
  endWorker();
  reject(new Error('cancelled'));
}
