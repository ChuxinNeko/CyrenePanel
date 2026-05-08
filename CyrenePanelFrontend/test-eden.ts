import { edenTreaty } from '@elysiajs/eden';

const api = edenTreaty("http://localhost:3008", {
  $fetch: {
    credentials: 'omit'
  }
});

console.log(api);
