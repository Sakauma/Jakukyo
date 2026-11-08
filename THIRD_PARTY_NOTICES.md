# Third-party notices

The local riichi rules, legal-action checks, hand scoring and match progression use **@kobalab/majiang-core 1.4.1**, by Satoshi Kobayashi, distributed under the MIT License. The package is bundled locally; gameplay does not contact a remote service.

Source: https://github.com/kobalab/majiang-core

## MIT License

Copyright (c) 2021 Satoshi Kobayashi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## gb-mahjong-js 2.2.1

Chinese national-standard scoring uses the package's pure JavaScript `lib/api/index.js` and `lib/core/constants.js` modules. The native legacy Fan entry point is not used by the browser or desktop game.

Source: https://github.com/tziakcha-stats/gb-mahjong-js

The MIT License (MIT)

Copyright (c) 2026 Choimoe <qwq.shq@gmail.com> (https://github.com/Choimoe)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Desktop runtime and frontend dependencies

The Windows package includes the official Electron runtime and its original `LICENSE` and `LICENSES.chromium.html`. A generated `THIRD-PARTY-LICENSES.txt` accompanies the package with the frontend production dependencies' full notices, including React, React DOM, Three.js and React Three Fiber. The 3D tile bodies, table/theme textures, game emblem, win effects and synthesized background music are implemented for this project. Standard tile symbols use the CC0 assets below.

## Standard mahjong tile symbols — FluffyStuff (CC0)

The 37 standard symbols (34 tile types and three red fives) are adapted from the transparent `Regular/*.svg` artwork in **riichi-mahjong-tiles**, by FluffyStuff. Only the symbol layers are bundled as local PNGs and painted onto this project's 3D faces and result tiles; the upstream Front/Back/Blank tile frames are not used. Flower tiles are drawn by this project.

Source: https://github.com/FluffyStuff/riichi-mahjong-tiles

License: https://github.com/FluffyStuff/riichi-mahjong-tiles/blob/master/LICENSE.md

Upstream license text:

> This work is in the public domain. For more information, visit https://creativecommons.org/publicdomain/zero/1.0/.

The official Mahjong Soul guide, USPML guide and result screenshots in development documentation are visual references only. They are not bundled in the game or used as game textures, characters, music or branding.
