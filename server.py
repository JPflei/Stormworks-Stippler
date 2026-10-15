"""Run the local upload/download interface with Python's standard library."""
import argparse
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from stippler import vary_xml


class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path not in ('/api/stipple', '/api/preview'):
            self.send_error(404)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 20 * 1024 * 1024:
                raise ValueError('Upload must be smaller than 20 MB.')
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError('Expected an upload object.')
            output, report = vary_xml(data.get('xml'), data.get('strength', 12), data.get('seed', 0))
            self.respond(200, {**({'xml': output} if self.path == '/api/stipple' else {}), **report})
        except (ValueError, TypeError, RecursionError) as exc:
            self.respond(400, {'error': str(exc)})

    def respond(self, status, data):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(payload)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--host', default='127.0.0.1')
    args = parser.parse_args()
    handler = partial(Handler, directory=str(Path(__file__).parent / 'web'))
    print(f'Stormworks Stippler listening on port {args.port}', flush=True)
    ThreadingHTTPServer((args.host, args.port), handler).serve_forever()
