"""Regenerate the bundled 32×44 tile atlas (optional art tool: Python + Pillow).

Rows are m/p/s/z/f, then three optically simplified suit rows for the small 3D
discards. Columns are the encoded rank (0 means red five).
The drawings are original; the characters are rasterized from the bundled OFL
font. No fonts, Python or image processing are needed when building the game.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from woodcut_art import export_blocks, sparrow

ROOT = Path(__file__).resolve().parent.parent
FLOWERS = json.loads((ROOT / 'src/game/flowerNames.json').read_text(encoding='utf-8'))
FONT = ImageFont.truetype(str(ROOT / 'src/assets/pixel-font/unifont-16px.woff2'), 16)
W, H = 32, 44
INK, BLUE, GREEN, JADE = '#253747', '#2c5873', '#17634e', '#67a584'
RED, CORAL, GOLD, PAPER = '#aa3640', '#e58267', '#dfaa60', '#fff2d4'


def glyph(im, letter, center, color, scale=1):
    # Trim to ink before centering: even a single horizontal stroke stays visible.
    left, top, right, bottom = FONT.getbbox(letter)
    mask = Image.new('1', (right - left, bottom - top))
    ImageDraw.Draw(mask).text((-left, -top), letter, fill=1, font=FONT)
    mask = mask.crop(mask.getbbox())
    if scale != 1:
        mask = mask.resize((mask.width * scale, mask.height * scale), Image.Resampling.NEAREST)
    im.paste(color, (center[0] - mask.width // 2, center[1] - mask.height // 2), mask)


def stamp(d, pattern, x, y, colors):
    for j, row in enumerate(pattern):
        for i, pixel in enumerate(row):
            if pixel != '.':
                d.point((x + i, y + j), fill=colors[pixel])


def coin(d, x, y, r, color):
    # Cast cash, with an open square hole. Three distinct dies, not one coin
    # resized nine times: the 9-dot die still leaves a whole pixel of paper.
    light = {RED:CORAL, GREEN:JADE, BLUE:'#76a3b4',INK:GOLD}[color]
    if r <= 6:
        # The larger die has a single, square, 3-dot aperture.
        fine = ['..hhh..','.hbbbh.','hbpppbb','hbpppbb','bbpppbb','.bbbbb.','..ddd..']
        middle = [
            '..hhhhh..','.hbbbbbh.','hbbbbbbbb','hbbpppbdb','hbbpppbdb','bbbpppbdb','bbdbbbbdb','.bdddddb.','..ddddd..']
        broad = ['...hhhhhhh...','..hhbbbbbbh..','.hhbbbbbbbbh.',
                 'hbbbhhhhhbbdb','hbbhppppphbdb','hbbhppppphbdb','bbbhppppphbdb',
                 'bbbhppppphbdb','bdbhppppphbdb','bdbbdddddbbdb','.bddbbbbbbdb.',
                 '..bdddddddb..','...ddddddd...']
        art = fine if r<=4 else middle if r==5 else broad
        stamp(d,art,x-len(art[0])//2,y-len(art)//2,dict(h=light,b=color,p=PAPER,d=INK))
        return
    def band(n,fill):
        c=max(2,n//3)
        d.polygon([(x-n+c,y-n),(x+n-c,y-n),(x+n,y-n+c),(x+n,y+n-c),
                   (x+n-c,y+n),(x-n+c,y+n),(x-n,y+n-c),(x-n,y-n+c)],fill)
    band(13,INK); band(11,GOLD); band(9,BLUE)
    for dx,dy,sx,sy in [(-8,-2,1,-1),(2,-8,1,1),(8,2,-1,1),(-2,8,-1,-1)]:
        d.line((x+dx,y+dy,x+dx+sx*3,y+dy+sy*3),PAPER,2)
    d.rectangle((x-4,y-4,x+4,y+4),INK)
    d.rectangle((x-3,y-3,x+3,y+3),GOLD); d.rectangle((x-2,y-2,x+2,y+2),PAPER)


def reed(d, x, y, half, color, light):
    # A sliced, slightly leaning culm with a dark joint and an off-axis leaf.
    # The negative cuts read as bamboo joints, even in a nine-bamboo.
    d.polygon([(x-2,y-half+1),(x,y-half-1),(x+2,y-half-1),(x+2,y+half-1),
               (x+1,y+half+1),(x-2,y+half+1)],color)
    d.line((x-1,y-half+1,x-1,y-2),light)
    d.line((x-1,y+2,x-1,y+half-1),light)
    d.rectangle((x-3,y-1,x+2,y),fill=color)
    d.line((x-2,y+1,x+2,y+1),INK)
    d.line((x-2,y-1,x+1,y-1),fill=light)
    if half>=5:
        d.polygon([(x+2,y),(x+3,y-4),(x+5,y-5),(x+5,y-3)],color)


def bird(im,d):
    d.line([(2,36),(11,33),(22,32),(27,29)],fill=GREEN,width=2)
    d.polygon([(6,35),(2,29),(6,31),(9,34)],fill=JADE)
    im.alpha_composite(sparrow(),(0,6))


def flower(im, d, rank):
    color = RED if rank <= 4 else GREEN
    if rank in (1, 5, 6, 8):
        d.line([(10,24),(14,21),(16,16),(20,11)], fill=GREEN, width=2)
        d.polygon([(12,23),(7,18),(11,18),(15,20)], fill=JADE)
        for x, y in ([(16,14),(22,9)] if rank in (1,5) else [(17,14)]):
            petals = [(0,-3),(3,-1),(2,3),(-2,3),(-3,-1)]
            for dx, dy in petals:
                w = 2 if rank == 6 else 1
                d.rectangle((x+dx-w,y+dy-1,x+dx+w,y+dy+1), fill=RED if rank in (1,5) else BLUE if rank == 6 else CORAL)
            d.rectangle((x-1,y-1,x+1,y+1), fill=GOLD)
    elif rank == 2:
        coin(d,17,15,6,RED)
        for x,y in ((17,6),(17,24),(8,15),(26,15)):
            d.rectangle((x-1,y-1,x+1,y+1), fill=CORAL)
    elif rank == 3:
        d.polygon([(8,11),(14,13),(16,7),(19,12),(24,9),(22,18),(15,22),(10,18)], fill=RED)
        d.line((11,24,21,13), fill=GOLD, width=2)
    elif rank == 4:
        for x,y in ((17,6),(9,9),(7,15),(9,21)):
            d.line((x,y,34-x,30-y), fill=BLUE, width=2)
        d.rectangle((15,13,19,17), fill=JADE)
    else:  # bamboo leaves
        reed(d,15,16,9,GREEN,JADE)
        for a,b,c,e in [(15,12,24,7),(15,18,23,15),(15,17,8,10)]:
            d.polygon([(a,b),(c,e),(c-1,e+4),(a,b+2)], fill=GREEN)
    glyph(im, FLOWERS[rank-1], (16,33), color)
    glyph(im, str(rank), (5,6), color)


LAYOUT = {
    2: [(16,12),(16,31)], 3: [(8,10),(16,22),(24,34)],
    4: [(9,12),(23,12),(9,31),(23,31)],
    5: [(8,9),(24,9),(16,22),(8,35),(24,35)],
    6: [(x,y) for y in (9,22,35) for x in (9,23)],
    7: [(7,7),(16,12),(25,17),(9,25),(23,25),(9,36),(23,36)],
    8: [(x,y) for y in (7,17,27,37) for x in (9,23)],
    9: [(x,y) for y in (9,22,35) for x in (6,16,26)],
}


def tile(suit, index):
    im = Image.new('RGBA', (W,H))
    d = ImageDraw.Draw(im)
    rank = index or 5
    if suit == 'm':
        # Two complete 16-dot characters fit without squashing their strokes.
        # A corner index also reads quickly at hand size.
        glyph(im, '一二三四五六七八九'[rank-1], (16,12), INK if index else RED)
        # Vermilion maker's cartouche; paper gaps around the full 16-dot master.
        d.polygon([(6,21),(24,21),(26,23),(26,40),(8,40),(6,38)],fill=RED)
        d.rectangle((8,21,19,21),fill=CORAL)
        glyph(im, '萬', (16,31), PAPER)
        if index:
            glyph(im, str(rank), (4,7), INK)
    elif suit == 'z':
        if rank == 5:  # White dragon: keep the center empty, even at river scale.
            d.rectangle((4,5,27,38),outline=INK,width=2)
            d.rectangle((7,8,24,35),outline=BLUE,width=1)
            for x,sx in [(4,1),(27,-1)]:
                for y,sy in [(5,1),(38,-1)]:
                    d.line([(x,y+sy*7),(x,y),(x+sx*7,y),(x+sx*7,y+3*sy),
                            (x+sx*4,y+3*sy),(x+sx*4,y+sy*5)],fill=BLUE,width=2)
                    d.point((x+2*sx,y+2*sy),fill=GOLD)
        else:
            char = '東南西北白發中'[rank-1]
            glyph(im, char, (16,23), '#d9c5a0', 2)
            glyph(im, char, (16,22), GREEN if rank==6 else RED if rank==7 else INK, 2)
    elif suit == 'f':
        flower(im,d,rank)
    elif suit == 's' and rank == 1:
        bird(im,d)
    elif suit == 'p' and rank == 1:
        coin(d,16,22,12,INK)
    else:
        points = LAYOUT[rank]
        if suit == 's' and rank == 3:
            points = [(16,11),(9,31),(23,31)]
        if suit == 's' and rank == 7:
            points = [(16,7), *[(x,y) for y in (16,26,36) for x in (9,23)]]
        for i, (x,y) in enumerate(points):
            if suit == 's':
                red = not index or rank == 7 and i == 0 or rank == 9 and 3 <= i < 6
                # Six reeds sit in three rows 13 dots apart; keep visible paper
                # between the joints so they never read as two continuous poles.
                half = 3 if rank >= 7 else 4 if rank == 6 else 5 if rank == 5 else 7
                reed(d,x,y,half, RED if red else GREEN, CORAL if red else JADE)
            else:
                if not index or rank==5 and i==2 or rank==6 and i>=2:
                    color = RED
                elif rank in (2,3,9):
                    color = (GREEN, BLUE, RED)[i // 3 if rank==9 else i]
                else:
                    color = GREEN if i<2 else BLUE
                coin(d,x,y,4 if rank>=7 else 5 if rank>=3 else 6,color)
    if index == 0:  # Red fives have a shape cue as well as red ink.
        d.polygon([(4,2),(6,4),(4,6),(2,4)], fill=RED)
    return im


def small_discard(suit, index):
    """At river size nine tiny pips turn into noise. Use a rank and a suit stamp."""
    im = Image.new('RGBA', (W,H))
    d = ImageDraw.Draw(im)
    rank = index or 5
    color = RED if not index else {'m': INK, 'p': BLUE, 's': GREEN}[suit]
    glyph(im, str(rank), (16,14), color, 2)
    if suit == 'm':
        glyph(im, '万', (16,34), RED)
    elif suit == 'p':
        coin(d,16,34,6,RED if not index else BLUE)
    else:
        reed(d,16,34,6,RED if not index else GREEN,JADE)
    if not index:
        d.polygon([(4,2),(6,4),(4,6),(2,4)], fill=RED)
    return im


if __name__ == '__main__':
    atlas = Image.new('RGBA', (10*W,8*H))
    for row, suit in enumerate('mpszf'):
        for rank in (range(10) if row<3 else range(1,8 if suit=='z' else 9)):
            atlas.paste(tile(suit,rank), (rank*W,row*H))
            if row < 3:
                atlas.paste(small_discard(suit,rank), (rank*W,(row+5)*H))
    atlas.save(ROOT / 'src/table/assets/pixel-tiles.png', optimize=True)
    export_blocks(ROOT / 'src/table/assets/woodcut')
