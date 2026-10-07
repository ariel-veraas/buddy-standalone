"""Helpers compartidos de los tests."""
import json

class FakeResponse:
    """The slice of requests.Response that buddy.provider uses."""

    def __init__(self, status=200, payload=None, body=None):
        self.status_code = status
        data = body if body is not None else json.dumps(payload if payload is not None else {}).encode()
        self.body = data
        self.raw = self
        self.closed = False
        self.position = 0  # the body is consumed piece by piece, like a socket
        self.reads = []  # the `amount` of every read

    @property
    def consumed(self):
        return self.position

    def read(self, amount=None, decode_content=False):
        self.reads.append(amount)
        end = len(self.body) if amount is None else min(len(self.body), self.position + amount)
        piece, self.position = self.body[self.position:end], end
        return piece

    def close(self):
        self.closed = True
