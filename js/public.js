import { applyTranslations } from './i18n.js';
import { renderFooter } from './ui.js';

applyTranslations();
const footer = document.querySelector('[data-footer]');
if (footer) renderFooter(footer);
