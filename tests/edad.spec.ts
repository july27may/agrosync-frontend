import { expect, test } from '@playwright/test'
import { age } from '../src/features/ganaderia/edad'

test('muestra años, meses y días completos al 19 de noviembre de 2026', () => {
  const today = '2026-11-19'
  expect(age(today, today)).toBe('Edad: 0 días')
  expect(age('2026-11-04', today)).toBe('Edad: 15 días')
  expect(age('2026-05-16', today)).toBe('Edad: 6 meses y 3 días')
  expect(age('2024-07-19', today)).toBe('Edad: 2 años y 4 meses')
  expect(age('2024-07-18', today)).toBe('Edad: 2 años, 4 meses y 1 día')
  expect(age(null, today)).toBe('Edad desconocida')
})

test('usa aniversarios de calendario y descarta fechas inválidas o futuras', () => {
  expect(age('2024-01-31', '2024-02-29')).toBe('Edad: 1 mes')
  expect(age('2024-02-29', '2025-03-01')).toBe('Edad: 1 año y 1 día')
  expect(age('2026-02-30', '2026-03-03')).toBe('Edad desconocida')
  expect(age('2026-11-20', '2026-11-19')).toBe('Edad desconocida')
})
