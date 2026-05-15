"""Metadados estáticos do serviço — fonte única pra nome e versão.

Importado por main.py (pra configurar o FastAPI) e pelos routers de
introspecção (health, root) pra evitar ciclo de import com `app`.
"""
SERVICE_NAME = "hub-quest-api"
API_VERSION = "0.5.0"
