import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

if (
  window.location.pathname === '/docs/api' ||
  window.location.pathname === '/docs/api/'
) {
  void import('./modules/docs/ApiDocs.vue').then(({ default: ApiDocs }) => {
    createApp(ApiDocs).mount('#app');
  });
} else createApp(App).mount('#app');
