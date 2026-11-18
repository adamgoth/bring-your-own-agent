import { tutorStore } from '../state/store';
import { createTools } from './registry';

/** The app's tool list, bound to the single store. */
export const appTools = createTools(tutorStore);
