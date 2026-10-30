<script setup lang="ts">
import { onMounted } from 'vue';
import SwaggerUI from 'swagger-ui-dist/swagger-ui-es-bundle.js';
import 'swagger-ui-dist/swagger-ui.css';

onMounted(() => {
  SwaggerUI({
    dom_id: '#swagger-ui',
    url: '/api/openapi.json',
    // Do not send our API specification to Swagger's external validator.
    validatorUrl: null,
    withCredentials: true,
    persistAuthorization: false,
    deepLinking: true,
  });
});
</script>

<template>
  <div>
    <header class="api-docs-header">
      <a href="/">Volver a LISFI</a>
      <p>
        Esta página permite ejecutar operaciones reales con la sesión del
        navegador.
      </p>
      <p>
        La API valida permisos, MFA y origen. Usá datos ficticios en desarrollo.
      </p>
    </header>
    <div id="swagger-ui"></div>
  </div>
</template>

<style scoped>
.api-docs-header {
  max-width: 1200px;
  margin: 1rem auto;
  padding: 0 1rem;
}
</style>
