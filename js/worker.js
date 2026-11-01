// The computer's thinking, kept off the page's own thread so the page stays
// smooth while it searches. Every question from the page (see thinker.js) is
// answered by answer() in ai.js, with word of how it's going along the way.

import { answer } from './ai.js';

onmessage = ({ data }) => {
  const { id, request } = data;
  try {
    postMessage({ id, result: answer(request, progress => postMessage({ id, progress })) });
  } catch (error) {
    postMessage({ id, error: error.message });
  }
};
