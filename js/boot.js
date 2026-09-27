// Entry point of the deployed site: password first, story after.

import { unlock } from './lock.js';
import { start } from './main.js';

unlock().then(start);
