"""Original, integer-grid print blocks for Jakukyo. No source pictures or resampling.

The same sparrow block appears on the one-bamboo tile, in the jade room and
in the landing sequence. Coordinates are decisions about ink, not a photo filter.
Optional build-time art tool only: python scripts/draw-pixel-tiles.py.
"""
from PIL import Image, ImageColor, ImageDraw

NIGHT, LAKE, JADE, LIGHT = '#202f39', '#235154', '#397e70', '#82b696'
RUST, PEACH, HONEY, IVORY = '#ac4043', '#df8467', '#e8ad63', '#fff0c9'


def sparrow(pose='rest'):
    """31×29, facing right. Separate wing and tail cuts for each key silhouette."""
    im = Image.new('RGBA', (31, 29))
    d = ImageDraw.Draw(im)
    poly, rect = d.polygon, d.rectangle
    air = pose in ('up', 'down', 'brake')
    if air:
        poly([(1,14),(8,17),(14,16),(14,21),(4,20),(5,18),(1,17)], NIGHT)
        rect((4,16,9,17), JADE)
    else:
        poly([(2,25),(7,17),(11,13),(15,15),(11,21),(6,25)], NIGHT)
        poly([(4,23),(9,17),(12,17),(8,22)], JADE)
    poly([(7,18),(9,13),(14,10),(20,8),(24,9),(26,13),(25,18),
          (21,22),(16,24),(11,23),(8,21)], NIGHT)
    poly([(9,17),(11,13),(17,10),(23,10),(24,15),(18,21),(12,21)], JADE)
    poly([(14,20),(18,16),(24,13),(24,17),(20,21),(16,22),(13,21)], IVORY)
    rect((16,22,18,22), HONEY)
    poly([(16,10),(17,6),(20,4),(24,4),(27,7),(27,12),(24,15),(18,15),(16,13)], NIGHT)
    poly([(17,8),(19,5),(23,5),(26,7),(25,9),(20,8)], RUST)
    rect((20,5,23,5), PEACH)
    poly([(17,10),(20,9),(24,10),(25,12),(22,14),(19,13)], IVORY)
    rect((21,11,23,12), NIGHT)  # familiar black cheek
    rect((24,8,25,9), NIGHT)
    poly([(27,8),(30,9),(27,11)], HONEY)
    if pose == 'up':
        poly([(9,17),(6,12),(3,3),(8,6),(7,1),(12,4),(17,12),(16,16),(12,19)], NIGHT)
        poly([(9,15),(7,7),(11,9),(10,5),(14,9),(16,13),(13,16)], JADE)
        poly([(9,12),(10,12),(14,15),(12,16)], LIGHT)
    elif pose == 'down':
        poly([(8,14),(14,13),(17,16),(13,22),(7,27),(7,23),(3,25),(5,20)], NIGHT)
        poly([(8,16),(14,14),(15,17),(10,23),(10,20),(6,23)], JADE)
        poly([(10,17),(13,16),(10,20),(7,21)], LIGHT)
    elif pose == 'brake':
        poly([(9,18),(5,13),(2,8),(7,10),(4,4),(10,7),(16,12),(16,16),(12,19)], NIGHT)
        poly([(8,14),(6,10),(10,12),(8,8),(14,12),(14,15),(11,17)], JADE)
        rect((9,13,11,14), LIGHT)
    else:
        poly([(7,20),(9,15),(14,12),(18,12),(19,15),(15,19),(10,21)], NIGHT)
        poly([(9,18),(11,15),(15,13),(17,13),(17,15),(12,19)], JADE)
        poly([(10,17),(13,15),(16,14),(16,15),(12,18),(10,18)], LIGHT)
    legs = 22 if air else 23
    for x in (15,20):
        rect((x,legs,x,legs+(2 if air else 3)), HONEY)
        rect((x-1,legs+(2 if air else 3),x+2,legs+(2 if air else 3)), RUST)
    return im


def leaf(d, x, y, dx, dy, ink):
    # Pointed, with the stalk on one side instead of four symmetric pixels.
    d.polygon([(x,y),(x+dx//3,y+dy//2-1),(x+dx,y+dy),(x+dx*2//3,y+dy*2//3+2),(x+dx//3,y+dy//2+2)], ink)


def twig(d, x, y, dark, mid, light):
    d.line([(x,y),(x+14,y-6),(x+29,y-7),(x+40,y-13),(x+57,y-14)],dark,3)
    d.line([(x+12,y-7),(x+27,y-8),(x+40,y-14),(x+55,y-15)],mid)
    for dx,dy,ex,ey in [(8,-4,-4,-11),(12,-6,1,-14),(17,-7,9,8),
                         (29,-8,-4,-13),(35,-11,4,-14),(44,-14,11,6),(49,-14,12,-6)]:
        leaf(d,x+dx,y+dy,ex,ey,mid)
    d.line((x+34,y-11,x+37,y-20),light)


def disk(d,x,y,r,ink):
    c=max(2,r//3)
    d.polygon([(x-r+c,y-r),(x+r-c,y-r),(x+r,y-r+c),(x+r,y+r-c),
               (x+r-c,y+r),(x-r+c,y+r),(x-r,y+r-c),(x-r,y-r+c)],ink)


def cloud(d,x,y,n,ink):
    d.rectangle((x,y,x+n,y+1),ink)
    d.rectangle((x+3,y-2,x+8,y),ink)
    d.rectangle((x+n-8,y+3,x+n+4,y+3),ink)


def ridge(d,x,y,ink):
    d.polygon([(x,y),(x+9,y-7),(x+12,y-7),(x+22,y-18),(x+26,y-19),
               (x+32,y-11),(x+37,y-14),(x+54,y),(x+60,y+2),(x,y+2)],ink)


def blossom(d,x,y,ink,center):
    for a,b in [(-2,-3),(1,-3),(3,0),(0,2),(-3,0)]:
        d.rectangle((x+a,y+b,x+a+2,y+b+2),ink)
    d.rectangle((x,y,x+1,y+1),center)


# felt, deep field ink, print ink, light ink, rail, gilt, field ornament
ROOMS = {
    'jade': ('#326e62','#295d56','#508974','#76a183','#67483b','#d8a864','bamboo'),
    'sakura': ('#855870','#70495f','#a36e83','#c48d98','#6e4549','#e7b487','petal'),
    'midnight': ('#38547c','#2c4569','#516f95','#85a4be','#323c57','#b8cbd3','moon'),
    'contrast': ('#384d58','#334853','#455a63','#708590','#36434b','#d8c899','plain'),
}


def corner(room, right):
    field, deep, mid, light, rail, metal, motif = ROOMS[room]
    p=Image.new('RGBA',(87,54)); d=ImageDraw.Draw(p)
    if motif=='bamboo':
        twig(d,3,49,deep,mid,light); cloud(d,45,16,17,mid)
        if not right:
            # Restrained ink on the felt; the same bird on the tile uses full contrast.
            bird=sparrow()
            inks={NIGHT:deep, LAKE:deep, JADE:mid, LIGHT:light, RUST:'#b07456',
                  PEACH:'#cb9468', HONEY:'#cda16a', IVORY:'#c2c4a0'}
            lut={ImageColor.getrgb(a): ImageColor.getrgb(b) for a,b in inks.items()}
            for y in range(bird.height):
                for x in range(bird.width):
                    r,g,b,a=bird.getpixel((x,y))
                    if a: bird.putpixel((x,y), (*lut[(r,g,b)],a))
            p.alpha_composite(bird,(20,11))
        else:
            for x,y in [(5,34),(13,32),(18,28)]:
                d.line((x-1,46,x+4,y-17),mid,2)
                for yy in (y,y-8):
                    d.rectangle((x+1,yy,x+4,yy+1),light)
                leaf(d,x+3,y-6,-7,-10,mid); leaf(d,x+3,y-13,12,-6,mid)
    elif motif=='petal':
        d.line([(2,49),(14,38),(27,34),(36,25),(51,22),(63,12)],deep,3)
        for x,y in [(16,36),(26,34),(36,25),(51,22),(60,14)]:
            d.line((x,y,x-4,y-9),mid,2); blossom(d,x-5,y-11,light,metal)
            if x%2==0: blossom(d,x+3,y-2,mid,light)
        for x,y in [(53,32),(61,38),(71,18)]: d.line((x,y,x+2,y-1),light,2)
    elif motif=='moon':
        disk(d,26,18,10,light); disk(d,30,15,9,field)
        ridge(d,5,45,deep); ridge(d,25,48,mid)
        for x,y in [(7,12),(44,8),(53,18),(61,5)]:
            d.line((x-2,y,x+2,y),light); d.line((x,y-2,x,y+2),light)
    if right: p=p.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    return p


def board(room):
    w,h=448,256
    field,deep,mid,light,rail,metal,motif=ROOMS[room]
    im=Image.new('RGBA',(w,h), NIGHT); d=ImageDraw.Draw(im)
    for i,c in [(1,rail),(4,metal),(5,NIGHT),(7,deep),(9,field)]:
        d.rectangle((i,i,w-1-i,h-1-i),fill=c)
    # Quiet center. Weaving comes in short clusters near the selvage only.
    if motif!='plain':
        for y in (13,18,h-16,h-21):
            for x in range(28+(y%3)*7,w-26,26):
                d.line((x,y,x+3,y),deep); d.point((x+4,y-1),deep)
        for x,flip in [(13,False),(w-13-87,True)]:
            im.alpha_composite(corner(room,flip),(x,h-69))
    # Each corner has a cut brass joint. The long sides are black lacquer, not noise.
    for x,sx in [(8,1),(w-9,-1)]:
        for y,sy in [(8,1),(h-9,-1)]:
            def path(pts,c):
                d.line([(x+sx*a,y+sy*b) for a,b in pts],c,1)
            path([(0,15),(0,0),(30,0)],metal)
            path([(3,12),(3,3),(14,3),(14,6),(7,6),(7,9)],mid)
            path([(0,19),(0,16),(2,16)],light)
            path([(16,3),(20,3),(20,2),(30,2)],mid)
    for x in (39,w-40):
        for y in (2,h-3): d.rectangle((x-1,y-1,x+1,y+1),metal)
    return im.convert('RGB')


def flight_strip():
    """Five hand-posed exposures: lift, beat, brake, catch and sit. No tween."""
    w,h=112,44
    strip=Image.new('RGB',(w*5,h),NIGHT)
    for i,(x,y,pose) in enumerate([(16,0,'up'),(29,1,'down'),(43,-1,'brake'),(53,6,'brake'),(54,3,'rest')]):
        scene=Image.new('RGBA',(w,h),'#294e52'); d=ImageDraw.Draw(scene)
        disk(d,80,16,12,HONEY); d.line((68,23,91,23),PEACH,2)
        cloud(d,11,9,18,'#547576'); cloud(d,81,11,20,'#d7c28d')
        ridge(d,-5,37,'#396560'); ridge(d,24,41,'#3e7066'); ridge(d,76,40,'#396560')
        d.polygon([(0,40),(18,36),(39,35),(57,32),(78,33),(111,29),(111,44),(0,44)],LAKE)
        twig(d,40,42,NIGHT,JADE,LIGHT)
        # Level bamboo node: at rest both feet end on row 29 above this cut.
        d.line([(61,35),(66,30),(76,30),(82,28)],NIGHT,2)
        d.rectangle((67,30,76,30),JADE)
        scene.alpha_composite(sparrow(pose),(x,y))
        if i==3:
            for a,b in [(72,32),(80,27),(59,28)]: d.line((a,b,a+2,b-2),IVORY)
        strip.paste(scene.convert('RGB'),(i*w,0))
    return strip


def export_blocks(folder):
    folder.mkdir(exist_ok=True)
    for room in ROOMS: board(room).save(folder / f'board-{room}.png',optimize=True)
    # This print also appears in the settings preview. Group chroma at 2×
    # before Q90 encoding, just like the tile portraits.
    strip=flight_strip()
    strip.resize((strip.width*2,strip.height*2), Image.Resampling.NEAREST).save(folder / 'sparrow-flight.webp', quality=90, method=6)
