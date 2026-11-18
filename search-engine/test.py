# from gradio_client import Client

# client = Client("mrdaaku/search-api")
# result = client.predict("latest AI news", "your api", 5, api_name="/search")
# print(result)

import os
import sys
from pathlib import Path

# .env padho (bina extra library ke)
env_path = Path(__file__).parent / ".env"
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
else:
    sys.exit(".env file nahi mili. OpenBin ke main folder me banao.")

key = os.environ.get("SEARCH_KEY")
space = os.environ.get("SEARCH_SPACE", "mrdaaku/search-api")
if not key:
    sys.exit("SEARCH_KEY .env me nahi mili.")

from gradio_client import Client

query = sys.argv[1] if len(sys.argv) > 1 else "latest AI news"
print(f"Searching: {query}")

client = Client(space)
data = client.predict(query, key, 5, api_name="/search")

if "error" in data:
    sys.exit(f"Error: {data['error']}")

for i, r in enumerate(data["results"], 1):
    print(f"\n[{i}] {r['title']}\n    {r['url']}\n    {r['snippet'][:150]}")