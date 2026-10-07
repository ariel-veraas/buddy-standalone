# Buddy

Un asistente que instalás en tu propio servidor y que responde las preguntas de tu equipo **con tus propios documentos**, mostrando de dónde sacó cada respuesta.

Subís PDF, Word o textos (o conectás una carpeta de Google Drive). La gente pregunta con sus palabras; Buddy busca los pasajes que corresponden, responde con ellos, cita las fuentes, reconoce cuando los documentos no dicen nada y le indica a la persona a quién preguntarle. Usás tu propia API key (Gemini, OpenAI, Claude o cualquier servidor compatible con OpenAI, como Ollama). Los documentos quedan en tu servidor; al proveedor de IA solo viajan los pasajes necesarios para cada pregunta.

**Qué lo hace distinto:** casi todos los chatbots de documentos solo responden. Buddy además te dice lo que *no* sabe. Cada pregunta sin respuesta se agrupa por tema en **Calidad → Qué falta documentar**: escribís el documento que falta, marcás el tema como listo y Buddy verifica (gratis, sin llamar a la IA) que ahora lo encuentra. Si la gente sigue preguntando, el tema vuelve a aparecer solo. El resultado es una base de conocimiento que mejora cada semana, no solo un bot.

## Instalación (3 pasos)

Necesitás Docker con Compose.

```bash
cp .env.example .env        # opcional: cambiar el puerto
docker compose up -d
```

Abrí <http://localhost:8080>. La primera pantalla te pide crear la cuenta de administrador. Después, en **Ajustes**, pegá la API key de tu proveedor y probá la conexión; en **Documentos**, creá una colección y subí archivos.

Antes de publicarlo en internet, ponelo detrás de HTTPS (cualquier proxy inverso) y definí `BUDDY_COOKIE_SECURE=1`.

## Qué incluye

- **Un personaje, no una caja de texto.** Elegí quién recibe a tu equipo: Mochi, Kitsu, Neko, Nube, Conejo u Osito, en ocho colores y con voz propia (cálida, profesional o divertida). Parpadea, te sigue con la mirada, piensa mientras responde, duda cuando los documentos no dicen, se derrite cuando le agradecés y se duerme si lo dejás solo. Cada persona tiene burbujas de chat, diez fondos con patrones, el color de sus mensajes y accesorios que se desbloquean usándolo (todo decorativo; respeta «reducir movimiento»). Se configura en *Ajustes → Personalidad*.

- **Respuestas con fuentes.** Búsqueda híbrida: texto en español (corrige tipeos, entiende sinónimos y preguntas de seguimiento) y, si querés, búsqueda por significado con embeddings.
- **Cuentas y roles.** Administrador, editor (maneja documentos y ve estadísticas) y usuario. Contraseñas con Argon2id, bloqueo ante intentos repetidos, sesiones que se pueden cerrar y registro de actividad.
- **Quién lee qué.** Cada colección es para todos o para grupos puntuales. El permiso se aplica en la consulta a la base, antes de puntuar o enviar nada a la IA. Si cambian los permisos de alguien, se descartan sus conversaciones previas.
- **Honestidad.** Si los documentos no responden, Buddy lo dice, muestra un contacto (configurable por tema) y puede crear un ticket. Avisa cuando hay documentos que se contradicen o poca evidencia.
- **Feedback anónimo.** Los votos 👍/👎 no guardan usuario ni hora; las preguntas sin respuesta quedan listadas para saber qué documentar.
- **Control de gasto.** Límites por persona y por empresa, tope de consultas simultáneas y una sola llamada al proveedor por pregunta.
- **Secretos cifrados.** La API key y la cuenta de servicio de Google se guardan cifradas y no se vuelven a mostrar.

## Uso diario

| Tarea | Cómo |
|---|---|
| Sumar personas | *Personas* → *Agregar persona* (la clave temporal se muestra una sola vez) |
| Restringir una colección | *Documentos* → *Editar* → grupos |
| Google Drive | *Ajustes* → pegá el JSON de la cuenta de servicio; compartí cada carpeta (solo lectura) con su email; en *Documentos* creá una colección de tipo Drive |
| Búsqueda por significado | *Ajustes* → *Búsqueda por significado* (apagada de fábrica: para calcularla se envía el texto de todos los documentos al proveedor) |
| Backup | `docker compose exec db pg_dump -U buddy buddy > buddy.sql` y guardá también el volumen `buddy-data` (tiene la clave que descifra tus API keys guardadas) |
| Actualizar | `git pull && docker compose up -d --build` |

Dejá un solo contenedor de la aplicación (es lo que trae el compose): el planificador de sincronizaciones y los límites viven en el proceso. Los pedidos simultáneos los atiende un pool de hilos.

## Seguridad

- Definí `BUDDY_SETUP_TOKEN` si el puerto es accesible antes de terminar la configuración inicial: el primer administrador necesitará ese código.
- Detrás de un proxy inverso, poné su IP en `BUDDY_TRUSTED_PROXIES`; si no, Buddy ignora `X-Forwarded-For` (si no, cualquiera podría falsear su IP).
- La dirección del proveedor de IA (proveedor *Otro*) la define solo un administrador y puede ser una dirección privada a propósito, para usar modelos locales como Ollama. Solo se rechazan las direcciones de metadatos de nube y link-local.
- Los intentos de login se frenan por cuenta **y** por IP (una cuenta nunca queda bloqueada para siempre). Las sesiones, conversaciones viejas, estadísticas y el registro de actividad se limpian solos; el vínculo entre una persona y su voto 👍/👎 anónimo se corta a los diez minutos.
- El texto de una pregunta se guarda solo si Buddy no pudo responderla (para saber qué documentar) o si activás *Guardar preguntas*; nunca junto con el nombre de quien preguntó.

## Entrenamiento semanal

En **Tickets**, el equipo escribe su respuesta o notas y marca la consulta como resuelta. **Entrenamiento** (administradores y editores) propone borradores usando solamente ese material humano de los últimos 14 días. Podés editar el título y el texto, elegir una colección de subidas y aprobar, o rechazar. Nada se publica antes de aprobarlo.

Cada aprobación crea una prueba de búsqueda para la pregunta original. Aprobar no suma XP: la próxima verificación diaria otorga el evento existente `topic_verified` (15 XP, una sola vez por prueba) cuando encuentra el documento esperado. Los sinónimos también requieren aprobación. Las variantes de `top_k` solo muestran resultados; vos decidís qué aplicar en Ajustes.

El planificador verifica a diario y ejecuta una sesión por semana ISO. **Entrenar ahora** permite repetir la sesión sin duplicar premios ni contar otra semana. Se conservan ocho resúmenes. Los borradores usan hasta cinco llamadas por ejecución, con entrada limitada y datos personales enmascarados. Se reutilizan el proveedor, el libro `Usage` y los cupos existentes: si falta configuración o se alcanza un límite, las tareas sin IA continúan. El control existente mide consultas, no dólares.

Las ocho medallas reflejan datos reales de calidad, temas y sesiones. Los sonidos siguen la preferencia personal y están apagados por defecto.

## Desarrollo

Ver la sección *Develop* del [README en inglés](README.md). `backend/dev/stub_llm_server.py` es un proveedor falso compatible con OpenAI para probar todo el flujo sin gastar crédito.

## Licencia

MIT — ver [LICENSE](LICENSE) y [NOTICE.md](NOTICE.md).
