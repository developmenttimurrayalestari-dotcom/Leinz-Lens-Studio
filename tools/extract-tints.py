"""Build the tint reference from the supplied CSV and rendered PDF.

All preview colors are sampled from the user's PDF. They are screen-reference
colors, not measured lens transmission, dye recipes, or production color values.
Requires PyMuPDF and Pillow. Supply both original source files on the CLI.
"""
import argparse
import collections
import csv
import json
import re
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def hex_color(image, x, y, half=3):
    values = [image.getpixel((xx, yy))[:3]
              for yy in range(round(y)-half, round(y)+half+1)
              for xx in range(round(x)-half, round(x)+half+1)]
    rgb = tuple(round(statistics.median(p[channel] for p in values)) for channel in range(3))
    return '#' + ''.join(f'{channel:02X}' for channel in rgb)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv', type=Path, required=True, help='Original semicolon-delimited tint catalog CSV')
    parser.add_argument('--pdf', type=Path, required=True, help='Original two-page tint reference PDF')
    parser.add_argument('--assets', type=Path, default=ROOT / 'dist' / 'assets', help='Output assets directory (default: repository dist/assets)')
    args = parser.parse_args()
    for name in ('csv', 'pdf', 'assets'):
        setattr(args, name, getattr(args, name).expanduser())
    for name in ('csv', 'pdf'):
        if not getattr(args, name).is_file():
            parser.error(f'--{name} must name an existing file: {getattr(args, name)}')
    for output in (args.assets, args.assets / 'swatches'):
        if output.exists() and not output.is_dir():
            parser.error(f'Output directory is not a directory: {output}')

    try:
        with args.csv.open(encoding='utf-8-sig', newline='') as stream:
            reader = csv.DictReader(stream, delimiter=';', strict=True)
            required_columns = {'tint_code', 'Descr', 'jenis_tinting'}
            if not reader.fieldnames or not required_columns.issubset(reader.fieldnames):
                parser.error('CSV must contain tint_code, Descr and jenis_tinting columns separated by semicolons.')
            if len(reader.fieldnames) != len(set(reader.fieldnames)):
                parser.error('CSV contains duplicate column names.')
            rows = list(reader)
    except (OSError, UnicodeError, csv.Error) as error:
        parser.error(f'Cannot read tint CSV: {error}')
    if len(rows) != 66:
        parser.error(f'The original tint catalog must contain 66 rows; found {len(rows)}.')
    for row_no, row in enumerate(rows, 2):
        if None in row or any(not isinstance(row.get(key), str) or not row[key].strip() for key in required_columns):
            parser.error(f'CSV row {row_no} has missing or extra values.')
        if row['jenis_tinting'] not in {'Solid', 'Gradient'}:
            parser.error(f'CSV row {row_no} has an unsupported jenis_tinting; expected Solid or Gradient.')
    if len({row['tint_code'] for row in rows}) != 66:
        parser.error('Tint codes must be unique across all 66 CSV rows.')

    try:
        import fitz
        from PIL import Image
    except ImportError:
        parser.error('Optional generator dependencies are missing. Install PyMuPDF and Pillow with: python -m pip install PyMuPDF Pillow')

    # Validate and render both pages in memory before creating any output files.
    # The sampling coordinates below belong to this original reference layout.
    pixmaps = {}
    pages = {}
    try:
        with fitz.open(args.pdf) as document:
            if not document.is_pdf or document.needs_pass:
                parser.error('--pdf must be an unencrypted PDF document.')
            if len(document) != 2:
                parser.error(f'The original reference PDF must contain 2 pages; found {len(document)}.')
            for page_no, page in enumerate(document, 1):
                if page.rotation != 0 or abs(page.rect.width - 566.928) > 0.01 or abs(page.rect.height - 753.448) > 0.01:
                    parser.error(f'PDF page {page_no} does not match the original 566.928 × 753.448 pt reference layout.')
                pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                pixmaps[page_no] = pixmap
                pages[page_no] = Image.frombytes('RGB', (pixmap.width, pixmap.height), pixmap.samples)
    except (OSError, RuntimeError, ValueError) as error:
        parser.error(f'Cannot read tint reference PDF: {error}')

    # Coordinates were verified visually against both supplied PDF pages.
    # Page 1 is a 4-column, 6-row grid. Page 2 has a category gap after row 3.
    p1_x, p1_y = [295, 505, 725, 940], [225, 416, 606, 798, 988, 1178]
    p2_x, p2_y = [176, 386, 600, 826], [216, 398, 581, 792, 981, 1173]
    p1_solid = {1, 4, 6, 8, 9, 10, 18}
    chart_names = {
        1:'Bazaar', 2:'Cerulean Frost', 3:'African Violet', 4:'Black',
        5:'Camel', 6:'Dark Medium Gray', 7:'Antique Brass', 8:'Cafe Noir',
        9:'Blue Gray', 10:'Brown Yellow', 11:'Army Green', 12:'Dark Brown Tangelo',
        13:'Smoke Grey', 14:'Mars', 15:'Rose Violet', 16:'Midnight Summer',
        17:'Ocean Mint', 18:'Ocean Blue', 19:'Sunset Oliv', 20:'Aurora',
        21:'Deep Sea', 22:'Stone Shadow', 23:'Forest', 24:'Cappucino',
        25:'Sunglass Black', 26:'Sunglass Black', 27:'Sunglass Blue', 28:'Sunglass Blue',
        29:'Sunglass Brown', 30:'Sunglass Brown', 31:'Sunglass Dark Green', 32:'Sunglass Dark Green',
        33:'Sunglass Red', 34:'Sunglass Red', 35:'Sunglass Yellow', 36:'Sunglass Yellow',
        37:'Therapeutic Grey', 38:'Therapeutic Grey', 39:'Therapeutic Orange 500', 40:'Therapeutic Orange 500',
        41:'Therapeutic Orange 527', 42:'Therapeutic Orange 527', 43:'Therapeutic Red 585', 44:'Therapeutic Red 585',
        45:'Therapeutic Scarlet 550', 46:'Therapeutic Scarlet 550', 47:'Therapeutic Yellow 450', 48:'Therapeutic Yellow 450',
    }
    chart_percent = dict(zip(range(25, 49), [75,90,80,90,80,90,80,90,75,80,10,20,80,90,50,70,60,80,70,90,70,90,10,20]))
    chart = {}
    swatches = {}
    for number in range(1, 49):
        page_no = 1 if number <= 24 else 2
        offset = number - (1 if page_no == 1 else 25)
        column, row = offset % 4, offset // 4
        x = (p1_x if page_no == 1 else p2_x)[column]
        y = (p1_y if page_no == 1 else p2_y)[row]
        radius = 75 if page_no == 1 else 69
        style = 'Solid' if page_no == 2 or number in p1_solid else 'Gradient'
        image = pages[page_no]
        top = hex_color(image, x, y-radius*0.86)
        middle = hex_color(image, x, y)
        bottom = hex_color(image, x, y+radius*0.86)
        box = [x-radius-4, y-radius-4, x+radius+4, y+radius+4]
        swatch_file = f'swatches/chart-{number:02d}.png'
        swatches[swatch_file] = image.crop(box)
        chart[number] = {
            'number': number, 'name': chart_names[number], 'kind': style,
            'group': 'fashion' if number <= 24 else ('sunglass' if number <= 36 else 'therapeutic'),
            'nominalPercent': chart_percent.get(number),
            'sourcePage': page_no, 'sourceRegion': box, 'sourceImage': f'assets/{swatch_file}',
            'topHex': top, 'midHex': middle, 'bottomHex': bottom,
        }

    items = []
    for row_no, source in enumerate(rows, 2):
        code = source['tint_code']
        match = re.fullmatch(r'(\d{2})([SG])', code)
        number = int(match.group(1)) if match else None
        family = match.group(1) if match else code
        percent_match = re.search(r'(\d+)\s*%', source['Descr'])
        nominal = int(percent_match.group(1)) if percent_match else None
        kind = source['jenis_tinting']
        group = ('special' if number is None else 'fashion' if number <= 24
                 else 'sunglass' if number <= 38 else 'therapeutic')
        entry = {
            'code':code, 'name':source['Descr'], 'kind':kind, 'family':family,
            'group':group, 'nominalPercent':nominal, 'previewHex':None,
            'previewMidHex':None, 'previewBottomHex':None, 'sourcePage':None,
            'referenceStatus':'missing', 'referenceNote':'Tidak ada swatch yang dapat dipetakan pada PDF.',
            'sourceRow':row_no, 'sourceRegion':None, 'sourceImage':None,
            'chartName':None, 'chartNominalPercent':None, 'chartKind':None,
            'chartGroup':None, 'chartTopHex':None, 'chartMidHex':None, 'chartBottomHex':None,
            'mappingMethod':'none', 'previewCalibrated':False,
            'requiresPhysicalSample':code in {'CON','CONG'},
        }
        if number in chart:
            reference = chart[number]
            entry.update({
                'sourcePage':reference['sourcePage'], 'sourceRegion':reference['sourceRegion'],
                'sourceImage':reference['sourceImage'], 'chartName':reference['name'],
                'chartNominalPercent':reference['nominalPercent'], 'chartKind':reference['kind'],
                'chartGroup':reference['group'], 'chartTopHex':reference['topHex'],
                'chartMidHex':reference['midHex'], 'chartBottomHex':reference['bottomHex'],
                'mappingMethod':'numeric-code-and-visual-label',
            })
            if kind == 'Solid':
                color = reference['midHex'] if reference['kind'] == 'Solid' else reference['topHex']
                entry.update(previewHex=color, previewMidHex=color, previewBottomHex=color)
            elif reference['kind'] == 'Gradient':
                entry.update(previewHex=reference['topHex'], previewMidHex=reference['midHex'], previewBottomHex=reference['bottomHex'])
            else:
                entry.update(previewHex=reference['midHex'], previewMidHex=None, previewBottomHex='#FFFFFF')
            if kind == reference['kind']:
                entry['referenceStatus'] = 'matched'
                entry['referenceNote'] = 'Kode dan jenis cocok dengan sampel PDF; warna layar diambil dari render PDF.'
            else:
                entry['referenceStatus'] = 'derived-style'
                entry['referenceNote'] = (
                    'PDF hanya menampilkan gradasi untuk nomor ini. Pratinjau solid memakai warna bagian atas sebagai ilustrasi; belum ada sampel solid terpisah.'
                    if kind == 'Solid' else
                    'PDF hanya menampilkan warna solid untuk nomor ini. Gradasi menuju bening adalah ilustrasi; profil gradasi produksi belum tersedia.'
                )
            if code in {'37S','38S'}:
                entry['referenceStatus'] = 'category-conflict'
                entry['referenceNote'] = 'Nama/kelompok CSV adalah Sunglass Grey, sedangkan PDF menyebut Therapeutic Grey. Kode dan warna rujukan ditampilkan; kelompok pesanan mengikuti CSV, perlu verifikasi lab.'
            if code == '42S':
                entry['referenceStatus'] = 'percent-conflict'
                entry['referenceNote'] = 'CSV mencantumkan Orange 527 70%, PDF kode 42 mencantumkan 80%. Pratinjau warna dinonaktifkan sampai perbedaan dikonfirmasi.'
                entry.update(previewHex=None, previewMidHex=None, previewBottomHex=None)
            if code in {'45S','46S'}:
                entry['referenceNote'] += ' CSV menyebut Red 550; PDF menyebut Scarlet 550, dengan nomor dan persentase yang sama.'
            if code in {'31S','32S'}:
                entry['referenceNote'] += ' CSV menyebut Green; PDF menyebut Dark Green pada nomor yang sama.'
        else:
            if code == '400':
                entry['referenceNote'] = 'Kode Lamda 400 ada dalam CSV tetapi tidak memiliki swatch pada PDF. Warna tidak ditebak dari nama.'
            elif code in {'CON','CONG'}:
                entry['referenceNote'] = 'Warna sesuai contoh. PDF meminta contoh lensa fisik untuk warna di luar daftar; warna digital hanya catatan konsultasi.'
            elif code == 'NOTE':
                entry['referenceNote'] = 'Warna sesuai catatan. Tidak ada warna baku dalam CSV/PDF; instruksi perlu ditinjau lab.'
        items.append(entry)

    csv_families = {int(i['family']) for i in items if re.fullmatch(r'\d{2}',i['family'])}
    absent = [chart[n] for n in sorted(set(chart)-csv_families)]
    result = {
        'schemaVersion':1,
        'summary':{
            'total':len(items), 'solid':sum(i['kind']=='Solid' for i in items),
            'gradient':sum(i['kind']=='Gradient' for i in items),
            'previewAvailable':sum(i['previewHex'] is not None for i in items),
            'groups':dict(collections.Counter(i['group'] for i in items)),
            'referenceStatuses':dict(collections.Counter(i['referenceStatus'] for i in items)),
            'specialCodes':[i['code'] for i in items if i['group']=='special'],
            'pdfOnlyFamilies':[str(c['number']).zfill(2) for c in absent],
        },
        'sources':{
            'catalogFilename':args.csv.name,
            'pdfFilename':args.pdf.name,
            'referenceDate':'2023-12-21',
            'referenceDateBasis':'Revisi yang tercantum dalam nama berkas sumber, bukan tanggal validasi saat ini.',
            'renderScale':2,
            'colorMethod':'Median 7×7 pixel dari render PDF RGB pada 2 pixel per point; posisi diverifikasi secara visual.',
            'colorLimit':'Warna layar adalah ilustrasi dari lembar cetak; bukan data spektral, VLT, UV, resep pewarna, atau hasil laboratorium terkalibrasi.',
            'nominalPercentMeaning':'Persentase disalin sebagai label katalog. Tidak ditafsirkan sebagai VLT, opacity, maupun transmisi terukur.',
            'referencePrices':{
                'currency':'IDR','unit':'pair','currentPriceVerified':False,
                'regularIncludingSunglass':{'leinzPremium':90000,'leinzRegular':60000},
                'therapeutic':{'leinzPremium':120000,'leinzRegular':120000},
                'note':'Harga historis pada PDF sumber; belum merupakan harga jual aktif atau terkini.',
            },
            'productionNotes':[
                'Setiap pemesanan wajib mencantumkan kode/nomor warna.',
                'Warna lensa dapat berbeda dari contoh cetakan karena cahaya, coating, penambahan UV, dan indeks bahan material.',
                'Untuk warna di luar kode daftar, PDF meminta contoh lensa fisik, bukan foto atau deskripsi warna; proses setelah contoh fisik diterima lab.',
            ],
        },
        'pdfOnlySwatches':absent,
        'items':items,
    }
    args.assets.mkdir(parents=True, exist_ok=True)
    (args.assets / 'swatches').mkdir(exist_ok=True)
    for page_no, pixmap in pixmaps.items():
        pixmap.save(str(args.assets / f'reference-page-{page_no}.png'))
    for swatch_file, swatch in swatches.items():
        swatch.save(args.assets / swatch_file)
    (args.assets/'tints.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result['summary'],ensure_ascii=False,indent=2))


if __name__ == '__main__':
    main()
