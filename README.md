# x32-patch-list
![License GPLv2](https://badgen.net/github/license/sammy8806/x32-patch-list)
![Build Status](https://badgen.net/github/status/sammy8806/x32-patch-list)

Generate printable patch lists from X32 scene files

## Just use it
This is the source for the X32 Patch List creator hosted on AppEngine: https://x32-patch.appspot.com/

This specific instance is hosted by:
![Sammy8806](https://badgen.net/mastodon/follow/sammy8806@layer8.space)

## Installing For yourself
This project now targets Python 3.14 and uses pinned dependency sets for runtime and local development.

Create an environment and install the development dependencies:

```bash
uv venv --python 3.14
source .venv/bin/activate
uv pip install -r requirements-dev.txt
```

## Running
`python main.py` will start a Flask development server.

For App Engine Standard, deploy with `app.yaml`. The app uses:

- `python314`
- `gunicorn` as the web server entrypoint

## Testing
Run the test suite with:

```bash
pytest
```
