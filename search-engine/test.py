from gradio_client import Client

client = Client("mrdaaku/search-api")
result = client.predict("latest AI news", "WO-WALI-KYA-LAGTI-HAI-BHAI", 5, api_name="/search")
print(result)