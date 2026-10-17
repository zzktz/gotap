<script setup>
import { onMounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import {
  AppstoreOutlined, CloudOutlined, EditOutlined, MonitorOutlined, PlusOutlined,
  RocketOutlined, SafetyOutlined, SettingOutlined, ThunderboltOutlined, ToolOutlined,
} from '@ant-design/icons-vue'
import client from '@/api/client'

const iconOptions = [
  'AppstoreOutlined', 'ThunderboltOutlined', 'ToolOutlined', 'RocketOutlined',
  'SettingOutlined', 'MonitorOutlined', 'CloudOutlined', 'SafetyOutlined',
]
const iconComponents = { AppstoreOutlined, CloudOutlined, MonitorOutlined, RocketOutlined, SafetyOutlined, SettingOutlined, ThunderboltOutlined, ToolOutlined }
const rows = ref([])
const loading = ref(false)
const saving = ref(false)
const open = ref(false)
const editingKey = ref('')
const form = reactive({ module_key: '', name: '', description: '', icon: 'AppstoreOutlined', sort_order: 0, enabled: true })

async function load() {
  loading.value = true
  try {
    const { data } = await client.get('/v1/admin/modules')
    rows.value = data.items || []
  } catch (error) {
    if (!error.adminAuthExpired) message.error(error.response?.data?.detail || '模块列表加载失败')
  } finally { loading.value = false }
}

function openCreate() {
  editingKey.value = ''
  Object.assign(form, { module_key: '', name: '', description: '', icon: 'AppstoreOutlined', sort_order: rows.value.length * 10, enabled: true })
  open.value = true
}

function openEdit(record) {
  editingKey.value = record.module_key
  Object.assign(form, record)
  open.value = true
}

async function save() {
  if (!form.name.trim()) return message.warning('请填写模块名称')
  if (!editingKey.value && !/^[a-z][a-z0-9_-]{1,63}$/.test(form.module_key)) return message.warning('标识需为 2-64 位小写字母、数字、下划线或连字符')
  saving.value = true
  const payload = { name: form.name.trim(), description: form.description.trim(), icon: form.icon, sort_order: form.sort_order, enabled: form.enabled }
  try {
    if (editingKey.value) await client.patch(`/v1/admin/modules/${editingKey.value}`, payload)
    else await client.post('/v1/admin/modules', { ...payload, module_key: form.module_key.trim().toLowerCase() })
    open.value = false
    message.success(editingKey.value ? '模块已更新' : '模块已添加')
    await load()
  } catch (error) { if (!error.adminAuthExpired) message.error(error.response?.data?.detail || '保存模块失败') }
  finally { saving.value = false }
}

async function toggle(record, enabled) {
  try {
    await client.patch(`/v1/admin/modules/${record.module_key}`, { enabled })
    record.enabled = enabled
    message.success(enabled ? '模块已开启' : '模块已关闭')
  } catch (error) {
    if (!error.adminAuthExpired) message.error(error.response?.data?.detail || '模块状态更新失败')
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-title">
      <div><h1>模块管理</h1><p>维护客户端功能模块。模块标识创建后不可修改，用于客户端关联独立功能。</p></div>
      <a-button type="primary" @click="openCreate"><PlusOutlined />添加模块</a-button>
    </div>
    <a-alert class="release-notice" type="info" show-icon message="模块说明" description="模块配置负责名称、图标、排序和启停状态；新增模块还需要在客户端实现对应功能并绑定模块标识。" />
    <a-card :bordered="false">
      <a-table :data-source="rows" :loading="loading" :pagination="false" row-key="module_key">
        <a-table-column title="模块" key="name">
          <template #default="{ record }"><div class="module-name"><component :is="iconComponents[record.icon] || AppstoreOutlined" /><div><strong>{{ record.name }}</strong><div class="muted">{{ record.description || '暂无描述' }}</div></div></div></template>
        </a-table-column>
        <a-table-column title="标识" data-index="module_key" />
        <a-table-column title="排序" data-index="sort_order" width="90" />
        <a-table-column title="状态" key="enabled" width="110">
          <template #default="{ record }"><a-switch :checked="record.enabled" checked-children="开启" un-checked-children="关闭" @change="value => toggle(record, value)" /></template>
        </a-table-column>
        <a-table-column title="操作" width="100">
          <template #default="{ record }"><a-button size="small" @click="openEdit(record)"><EditOutlined />编辑</a-button></template>
        </a-table-column>
      </a-table>
    </a-card>
    <a-modal v-model:open="open" :title="editingKey ? '编辑模块' : '添加模块'" :confirm-loading="saving" ok-text="保存" cancel-text="取消" @ok="save">
      <a-form layout="vertical">
        <a-form-item v-if="!editingKey" label="模块标识" required><a-input v-model:value="form.module_key" placeholder="例如 clicker 或 image_tool" /><div class="setting-hint">创建后不可修改，仅允许小写字母、数字、下划线和连字符。</div></a-form-item>
        <a-form-item label="模块名称" required><a-input v-model:value="form.name" maxlength="80" placeholder="例如 自动点击器" /></a-form-item>
        <a-form-item label="模块说明"><a-textarea v-model:value="form.description" :rows="3" maxlength="500" /></a-form-item>
        <a-form-item label="图标"><a-select v-model:value="form.icon"><a-select-option v-for="icon in iconOptions" :key="icon" :value="icon"><component :is="iconComponents[icon] || AppstoreOutlined" /> {{ icon }}</a-select-option></a-select></a-form-item>
        <a-form-item label="排序"><a-input-number v-model:value="form.sort_order" :min="0" :max="10000" /></a-form-item>
        <a-form-item label="状态"><a-switch v-model:checked="form.enabled" checked-children="开启" un-checked-children="关闭" /></a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.module-name { display: flex; align-items: flex-start; gap: 12px; }
.module-name > :first-child { margin-top: 3px; color: #3b82f6; font-size: 18px; }
.module-name .muted { margin-top: 3px; }
</style>
