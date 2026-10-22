# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *


class WebProbe(gl.Contract):
    """Debug tool: fetch a URL with real consensus and store status + snippet."""

    url: str
    status: u256
    snippet: str

    def __init__(self):
        self.url = ""
        self.status = u256(0)
        self.snippet = ""

    @gl.public.write
    def probe(self, url: str) -> None:
        def fetch() -> dict:
            response = gl.nondet.web.request(url, method="GET")
            body = (response.body or b"").decode("utf-8", errors="replace")
            return {"status": int(response.status), "body": body}

        result = gl.eq_principle.strict_eq(fetch)
        self.url = url
        self.status = u256(int(result["status"]))
        self.snippet = str(result["body"])[:400]

    @gl.public.view
    def get_probe(self) -> dict:
        return {"url": self.url, "status": int(self.status), "snippet": self.snippet}
