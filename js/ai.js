// Anthropic messages API 呼叫(tool use)。金鑰只從設定讀取,不內建。
export const API_URL = 'https://api.anthropic.com/v1/messages';

export const CLASSIFY_TOOL = {
  name: 'classify_photo',
  description: '判斷照片類型,供前端排列建議動作。只做判斷,不做計算。',
  input_schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['receipt', 'menu', 'bill_list', 'table', 'form', 'text_doc', 'plant', 'object', 'screenshot', 'other'] },
      summary: { type: 'string', description: '一句話描述,例如「收據(5 個品項,合計 350)」;讀不清楚就不要寫數字' },
      detected: {
        type: 'object',
        properties: { numbers: { type: 'array', items: { type: 'string' } }, language: { type: 'string' }, has_prices: { type: 'boolean' } },
      },
      suggested_actions: { type: 'array', items: { type: 'string', enum: ['record', 'split', 'calc', 'translate', 'lookup', 'excel', 'menu', 'other'] } },
    },
    required: ['kind', 'summary'],
  },
};

export const TOOLS = [
  {
    name: 'answer',
    description: '一般問答、翻譯、植物/生物辨識、算數字等,直接用文字回答。text 可用 Markdown(粗體、條列)。',
    input_schema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
  {
    name: 'record_expense',
    description: '使用者要把收據/消費記入記帳本時使用。只負責讀取與整理欄位,不要自己加總或乘除。',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD;讀不到就留空' },
        store: { type: 'string' },
        total: { type: 'number', description: '收據上印的總額,照抄' },
        currency: { type: 'string', description: '預設 TWD' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, qty: { type: 'number' }, unit_price: { type: 'number' }, amount: { type: 'number', description: '收據上該行金額,照抄' } },
            required: ['name'],
          },
        },
        payment_method: { type: 'string' },
        category: { type: 'string' },
        payer: { type: 'string' },
        shared: { type: 'boolean', description: '是否家庭共用' },
        note: { type: 'string' },
        conflicts: {
          type: 'array',
          description: '口述與收據不一致的欄位,不可自行擇一',
          items: {
            type: 'object',
            properties: { field: { type: 'string' }, voice_value: { type: 'string' }, receipt_value: { type: 'string' } },
            required: ['field', 'voice_value', 'receipt_value'],
          },
        },
        questions: {
          type: 'array',
          description: '缺漏欄位的提問,最多 5 題,每題 2~5 個選項,先問最關鍵(分類、付款方式、誰付、是否家庭共用)',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, field: { type: 'string' }, text: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } },
            required: ['id', 'text'],
          },
        },
        confidence_notes: { type: 'string', description: '讀不清楚/不確定之處' },
      },
      required: ['items'],
    },
  },
  {
    name: 'extract_table',
    description: '使用者要把表格/表單/需求明細轉成 Excel 時使用:忠實照抄儲存格內容,不猜、不補、不計算。',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '檔案/表單標題;沒有就留空' },
        sheets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '工作表名稱(30 字內)' },
              columns: { type: 'array', items: { type: 'string' }, description: '表頭;沒有表頭就給空陣列' },
              rows: { type: 'array', items: { type: 'array', items: { type: ['string', 'number', 'null'] } }, description: '每列的儲存格,長度與 columns 一致;空格用空字串。欄位明顯是數量/金額就輸出 number,其餘(品名、編號、電話、日期)用 string' },
              notes: { type: 'string', description: '合併儲存格、備註、表外文字等說明' },
            },
            required: ['name', 'columns', 'rows'],
          },
        },
        unreadable: {
          type: 'array',
          description: '讀不清楚或手寫不確定的儲存格',
          items: {
            type: 'object',
            properties: {
              sheet: { type: 'string', description: '工作表名稱' },
              row: { type: 'integer', description: '資料列編號,從 1 起算;表頭列填 0' },
              col: { type: 'integer', description: '欄編號,從 1 起算' },
              reason: { type: 'string' },
            },
            required: ['row', 'col', 'reason'],
          },
        },
      },
      required: ['sheets'],
    },
  },
  {
    name: 'extract_menu',
    description: '使用者要把菜單(飲料店/餐廳)照片做成點餐菜單時使用:忠實照抄品名與價格,不猜、不補、不計算。',
    input_schema: {
      type: 'object',
      properties: {
        shop_name: { type: 'string', description: '店名;看不到就留空' },
        categories: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '分類名稱(例:奶茶類)' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    prices: { type: 'object', description: '依尺寸的價格,鍵是尺寸名(例:{"M":45,"L":55});只有一種價格就不要填,改填 price', additionalProperties: { type: 'number' } },
                    price: { type: 'number', description: '只有單一價格時填' },
                    note: { type: 'string' },
                    available_temps: { type: 'array', items: { type: 'string', enum: ['冰', '熱', '溫'] }, description: '照片明確標示僅熱/僅冰時才填' },
                  },
                  required: ['name'],
                },
              },
            },
            required: ['name', 'items'],
          },
        },
        size_names: { type: 'array', items: { type: 'string' }, description: '尺寸名稱,以照片為準(常見 M/L 或 中/大);沒有尺寸就給空陣列' },
        ice_levels: { type: 'array', items: { type: 'string' }, description: '照片有列冰度才填;沒列就回傳空陣列,不要自創' },
        sugar_levels: { type: 'array', items: { type: 'string' }, description: '照片有列糖度才填;沒列就回傳空陣列,不要自創' },
        toppings: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, price: { type: 'number' } }, required: ['name'] } },
        notes: { type: 'string', description: '菜單上的備註/公告' },
        unreadable: { type: 'array', items: { type: 'string' }, description: '看不清楚的品項或價格(描述位置)' },
      },
      required: ['categories'],
    },
  },
  {
    name: 'parse_expenses',
    description: '使用者口述/貼上一段話描述多筆「誰付了多少錢」時使用:拆成多筆付費記錄。只照抄人名與金額,不計算分攤。',
    input_schema: {
      type: 'object',
      properties: {
        records: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '這筆花在什麼(例:買飲料)' },
              payer: { type: 'string', description: '實際付錢的人' },
              amount: { type: 'integer', description: '整數元;口述的「一千零二十四」「一零二四」都轉成 1024' },
              participants: { type: 'array', items: { type: 'string' }, description: '使用者明確說了誰分攤才填;沒說就不要填(程式視為全員)' },
              note: { type: 'string' },
            },
            required: ['title', 'payer', 'amount'],
          },
        },
        members: { type: 'array', items: { type: 'string' }, description: '提到的所有人名(同音錯字、相近的人名請歸併成同一個)' },
        questions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, required: ['id', 'text'] }, description: '人名可能是同一人、金額聽不清楚等需要使用者確認的事' },
        unclear: { type: 'array', items: { type: 'string' }, description: '聽不懂或不確定的片段' },
      },
      required: ['records'],
    },
  },
  {
    name: 'update_split',
    description: '使用者用文字/語音說明某一筆記錄「誰分攤、誰沒吃、誰吃幾份、各人金額、哪些品項歸誰」時使用。只整理成結構,金額加總與餘數由程式處理。',
    input_schema: {
      type: 'object',
      properties: {
        participants: { type: 'array', items: { type: 'string' }, description: '平均分給這些人(只有平均分時填)' },
        shares: { type: 'object', additionalProperties: { type: 'integer' }, description: '份數,例 {"小新":2,"小玉":1}' },
        amounts: { type: 'object', additionalProperties: { type: 'integer' }, description: '各人自訂金額(整數元)' },
        items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, qty: { type: 'number' }, amount: { type: 'integer' }, people: { type: 'array', items: { type: 'string' }, description: '這個品項由誰負擔;空陣列=全員' } }, required: ['name', 'amount'] }, description: '明細帳品項(收據上的品項金額照抄)' },
        questions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, required: ['id', 'text'] } },
      },
    },
  },
  {
    name: 'extract_receipt',
    description: '從收據/帳單照片列出品項與金額:忠實照抄,不猜、不加總。',
    input_schema: {
      type: 'object',
      properties: {
        store: { type: 'string' },
        items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, qty: { type: 'number' }, amount: { type: 'integer', description: '該行金額,照抄' } }, required: ['name', 'amount'] } },
        extra_fees: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, amount: { type: 'integer' } }, required: ['name', 'amount'] }, description: '服務費、稅等' },
        total: { type: 'integer', description: '收據印的總額,照抄' },
        unreadable: { type: 'array', items: { type: 'string' } },
      },
      required: ['items'],
    },
  },
  {
    name: 'calc_numbers',
    description: '使用者要計算照片中的數字時使用:只負責抽出數字與選擇運算方式,不要自己算出結果,由程式計算。',
    input_schema: {
      type: 'object',
      properties: {
        numbers: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'number' } }, required: ['value'] } },
        op: { type: 'string', enum: ['sum', 'avg', 'diff', 'product', 'min', 'max', 'count'], description: '依使用者說明挑最合適的運算' },
        note: { type: 'string', description: '讀不清楚的數字或假設' },
      },
      required: ['numbers'],
    },
  },
  {
    name: 'split_bill',
    description: '使用者要分帳時使用。只負責讀品項、人名、誰點什麼;金額計算由程式處理。',
    input_schema: {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, qty: { type: 'number' }, amount: { type: 'number' } }, required: ['name', 'amount'] } },
        people: { type: 'array', items: { type: 'string' } },
        assignments: {
          type: 'array',
          items: {
            type: 'object',
            properties: { item_index: { type: 'integer', description: 'items 的索引,從 0 起算' }, people: { type: 'array', items: { type: 'string' } }, mode: { type: 'string', enum: ['equal', 'individual'] } },
            required: ['item_index', 'people', 'mode'],
          },
        },
        extra_fees: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, amount: { type: 'number' }, percent: { type: 'number', description: '收據只寫百分比時填,金額由程式算' }, allocate: { type: 'string', enum: ['proportional', 'equal'] } },
            required: ['name', 'allocate'],
          },
        },
        receipt_total: { type: 'number', description: '收據印的總額(供程式核對)' },
        unclear: { type: 'array', items: { type: 'string' }, description: '看不清楚或不確定的地方' },
      },
      required: ['items', 'people'],
    },
  },
];

export function buildSystem(today, categories) {
  return [
    '你是「多功能拍照工具」的助理。使用者用手機拍照(收據、菜單、植物、數字…)並用口述或文字說明需求,請用繁體中文(台灣用語)回應。',
    '今天日期:' + today + '。',
    '每次回應必須呼叫且只呼叫一個工具:answer(一般問答/翻譯/查資料)、record_expense(記入記帳本)、split_bill(分帳)、calc_numbers(抽出數字讓程式計算)、extract_table(表格/表單轉 Excel)、extract_menu(菜單做成點餐菜單)、parse_expenses(口述多筆付費)、update_split(說明某筆怎麼分)、extract_receipt(讀收據品項)。',
    '重要規則:',
    '1. 使用者口述常有同音錯字與數字誤聽(「75」「七十五」「七五」可能是同一個數字),請結合照片判斷。',
    '2. 收據或照片讀不清楚就標記(放入 confidence_notes、unclear 或 questions),不要猜。',
    '3. 你不做任何加總、乘除、分攤;金額欄位照抄收據,所有計算由程式處理。',
    '4. 口述的日期若是「20261123」這類格式,轉成 2026-11-23。',
    '5. 口述與照片不一致時,必須列在 conflicts(欄位、voice_value、receipt_value),不可自行擇一。',
    '6. 缺漏欄位用 questions 詢問,每題附 2~5 個選項,一次最多 5 題,先問最關鍵的:分類、付款方式、誰付、是否家庭共用。分類選項請用:' + categories.join('、') + '。已能確定的欄位不要再問。',
    '7. 植物/生物辨識用 answer:給 1~3 個候選(學名+俗名)、信心(高/中/低)、辨識依據、可能混淆種、習性/用途/毒性或可食警示、建議補拍的部位;不確定要明講。',
    '8. 翻譯/菜單:逐項翻譯並簡述內容;算數字:列出你讀到的數字與算式,但最終數字請明確標示是估算,建議使用者核對。',
    '9. 使用者追問或更正時,請重新呼叫適當的工具,輸出完整內容(不是只輸出差異)。',
    '10. extract_table:忠實照抄,不要猜、不要補、不要計算;合併儲存格只在第一格填值並在 notes 說明;數量/金額欄輸出數字,編號/電話/日期等保持字串(保留前導 0);手寫或模糊不確定的格子必須列入 unreadable(sheet、row、col、reason),格內先填你最佳判讀或留空。多張照片或多頁 PDF 依使用者指示合併成同一工作表續接(只保留一份表頭)或每張一個工作表。使用者要求修改時,依「目前表格」內容回傳完整修正後的表格。',
    '11. extract_menu:忠實照抄品名與價格,不要猜、不要補。照片沒有列冰度或糖度時,ice_levels / sugar_levels 回傳空陣列,不要自創(由程式套用台灣常用預設)。大小以照片為準(常見 M/L 或 中/大)。多張照片是同一份菜單的不同頁,請合併成一份。看不清楚的品項或價格寫進 unreadable,不要猜。',
    '12. parse_expenses:忠實照抄人名與金額,不計算分攤。口述的數字可能是「一千零二十四」「1024」「一零二四」,轉成整數。使用者沒說誰分攤就不要填 participants(視為全員)。人名可能同音錯字,相近的人名請歸併成同一個並用 questions 向使用者確認。',
    '13. update_split:使用者說「冰棒小凱沒吃,小新吃兩份」這類說明時,輸出參與者/份數/各人金額/品項歸屬;不要自己加總或分攤。extract_receipt:收據讀不清楚的品項寫進 unreadable,不要猜。',
  ].join('\n');
}

export const MODE_HINTS = {
  auto: '',
  expense: '(使用者選擇的動作:記帳,請使用 record_expense)',
  split: '(使用者選擇的動作:分帳/結帳,請使用 split_bill)',
  translate: '(使用者選擇的動作:翻譯,請使用 answer)',
  plant: '(使用者選擇的動作:辨識植物/生物)',
  lookup: '(使用者選擇的動作:查資料,請辨識照片中的物件/植物等,用 answer 回覆詳細資料)',
  calc: '(使用者選擇的動作:計算,請把照片中的數字抽出並呼叫 calc_numbers,不要自己算結果)',
  excel: '(使用者選擇的動作:轉 Excel,請使用 extract_table)',
  menu: '(使用者選擇的動作:做成點餐菜單,請使用 extract_menu)',
  other: '',
};

export async function callModel(settings, messages, system, opts) {
  opts = opts || {};
  const proxy = (settings.proxyUrl || '').trim();
  const headers = { 'content-type': 'application/json' };
  if (!proxy) {
    if (!settings.apiKey) { const e = new Error('尚未設定 API 金鑰或中轉網址'); e.code = 'NO_KEY'; throw e; }
    headers['x-api-key'] = settings.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }
  const body = {
    model: opts.model || settings.model || 'claude-sonnet-5-5',
    max_tokens: opts.max_tokens || 4096,
    system,
    tools: opts.tools || TOOLS,
    tool_choice: opts.tool_choice || { type: 'any' },
    messages,
  };
  const res = await fetch(proxy || API_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    let t = '';
    try { t = (await res.text()).slice(0, 300); } catch (_) { /* ignore */ }
    const e = new Error('API 錯誤 ' + res.status + (t ? ':' + t : ''));
    e.code = 'HTTP';
    throw e;
  }
  return res.json();
}

// 拍完先用小模型分類照片,回傳 classify_photo 的 input
export async function classifyPhotos(settings, blobs) {
  const content = [];
  for (const b of blobs) content.push(await fileBlock(b));
  content.push({ type: 'text', text: '請判斷這些照片的類型並呼叫 classify_photo。summary 用繁體中文、一句話;看不清楚的數字不要猜。' });
  const resp = await callModel(settings, [{ role: 'user', content }],
    '你是照片分類器,只負責判斷照片類型與建議動作(record=記帳、split=分帳/結帳、calc=計算、translate=翻譯、lookup=查資料、excel=轉 Excel(表格/表單/明細)、menu=菜單做成點餐菜單、other=其他)。',
    { model: settings.classifyModel || 'claude-haiku-5-5', tools: [CLASSIFY_TOOL], tool_choice: { type: 'tool', name: 'classify_photo' }, max_tokens: 600 });
  const tu = (resp.content || []).find(b => b.type === 'tool_use' && b.name === 'classify_photo');
  if (!tu) throw new Error('分類沒有回傳結果');
  return tu.input || {};
}

// 圖片 → image block;PDF → document block(整份送模型,不在前端轉圖)
export async function fileBlock(b) {
  const data = await blobToBase64(b);
  if (b.type === 'application/pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  return { type: 'image', source: { type: 'base64', media_type: b.type && b.type.startsWith('image/') ? b.type : 'image/jpeg', data } };
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
