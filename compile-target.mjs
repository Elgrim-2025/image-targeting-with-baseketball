/**
 * compile-target.mjs
 * t-Sample.png → assets/image-targets/ 컴파일
 * 실행: node compile-target.mjs
 */

import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const INPUT_IMAGE = path.join(__dirname, 'assets/t-Sample.png');
const OUTPUT_DIR  = path.join(__dirname, 'assets/image-targets');
// bundle.js 의 imageTarget.name 과 반드시 일치해야 함
const TARGET_NAME = 't-Sample';
const LUMINANCE_HEIGHT = 640;

async function getDefaultCrop(metadata) {
  const { width, height } = metadata;
  if (width / 3 > height / 4) {
    const croppedWidth = Math.round((height * 3) / 4);
    return {
      left: Math.round((width - croppedWidth) / 2),
      top: 0,
      width: croppedWidth,
      height,
      isRotated: false,
      originalWidth: width,
      originalHeight: height,
    };
  } else {
    const croppedHeight = Math.round((width * 4) / 3);
    return {
      left: 0,
      top: Math.round((height - croppedHeight) / 2),
      width,
      height: croppedHeight,
      isRotated: false,
      originalWidth: width,
      originalHeight: height,
    };
  }
}

async function main() {
  console.log('이미지 타겟 컴파일 시작...');
  console.log('입력:', INPUT_IMAGE);

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const image    = sharp(INPUT_IMAGE);
  const metadata = await image.metadata();
  console.log(`이미지 크기: ${metadata.width}x${metadata.height}`);

  const crop = await getDefaultCrop(metadata);
  console.log('크롭:', crop);

  // luminance 이미지 생성 (그레이스케일, 640px 높이)
  const luminancePath = path.join(OUTPUT_DIR, `${TARGET_NAME}_luminance.png`);
  await image
    .clone()
    .extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height })
    .resize({ height: LUMINANCE_HEIGHT })
    .grayscale()
    .png()
    .toFile(luminancePath);

  console.log('luminance 이미지 저장:', luminancePath);

  // XrController.configure 에 전달할 JSON 데이터
  const data = {
    imagePath: `assets/image-targets/${TARGET_NAME}_luminance.png`,
    name:      TARGET_NAME,
    type:      'FLAT',
    properties: crop,
    metadata:  null,
    created:   Date.now(),
    updated:   Date.now(),
  };

  const jsonPath = path.join(OUTPUT_DIR, `${TARGET_NAME}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(data, null, 2) + '\n');
  console.log('JSON 데이터 저장:', jsonPath);
  console.log('\n컴파일 완료!');
  console.log('다음 단계: 8th Wall 프로젝트를 브라우저에서 열면 이미지 트래킹이 작동합니다.');
}

main().catch(err => {
  console.error('오류:', err.message);
  process.exit(1);
});
