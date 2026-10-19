FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice-writer \
        libreoffice-impress \
        libreoffice-draw \
        fontconfig \
        fonts-noto-cjk \
        fonts-crosextra-carlito \
        fonts-crosextra-caladea \
        fonts-liberation \
        fonts-arphic-ukai \
        fonts-arphic-uming \
        fonts-wqy-zenhei \
    && mkdir -p /etc/fonts/conf.d \
    && printf '%s\n' \
        '<?xml version="1.0"?>' \
        '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">' \
        '<fontconfig>' \
        '  <!-- 将常见商业字体映射到 metrically compatible 的开源字体。 -->' \
        '  <match target="pattern"><test name="family" compare="eq"><string>Calibri</string></test><edit name="family" mode="assign"><string>Carlito</string></edit></match>' \
        '  <match target="pattern"><test name="family" compare="eq"><string>Cambria</string></test><edit name="family" mode="assign"><string>Caladea</string></edit></match>' \
        '  <match target="pattern"><test name="family" compare="eq"><string>Arial</string></test><edit name="family" mode="assign"><string>Liberation Sans</string></edit></match>' \
        '  <match target="pattern"><test name="family" compare="eq"><string>Times New Roman</string></test><edit name="family" mode="assign"><string>Liberation Serif</string></edit></match>' \
        '  <match target="pattern"><test name="family" compare="eq"><string>Courier New</string></test><edit name="family" mode="assign"><string>Liberation Mono</string></edit></match>' \
        '  <match target="pattern"><test name="family" compare="eq"><string>Microsoft YaHei</string></test><edit name="family" mode="assign"><string>Noto Sans CJK SC</string></edit></match>' \
        '  <match target="pattern"><test name="family" compare="eq"><string>微软雅黑</string></test><edit name="family" mode="assign"><string>Noto Sans CJK SC</string></edit></match>' \
        '  <match target="pattern"><test name="family" compare="eq"><string>SimSun</string></test><edit name="family" mode="assign"><string>Noto Serif CJK SC</string></edit></match>' \
        '  <match target="pattern"><test name="family" compare="eq"><string>宋体</string></test><edit name="family" mode="assign"><string>Noto Serif CJK SC</string></edit></match>' \
        '  <match target="pattern"><test name="family" compare="eq"><string>SimHei</string></test><edit name="family" mode="assign"><string>Noto Sans CJK SC</string></edit></match>' \
        '  <match target="pattern"><test name="family" compare="eq"><string>黑体</string></test><edit name="family" mode="assign"><string>Noto Sans CJK SC</string></edit></match>' \
        '</fontconfig>' \
        > /etc/fonts/local.conf \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app

RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /data \
    && chown -R appuser:appuser /app /data
USER appuser

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
